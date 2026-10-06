import { Injectable } from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import {
  RawResourceReference,
  ResourceIdentityResolution,
  isAdmissibleAfterExamination,
  normalizeResourceName,
} from './resource-identity-resolution.kernel';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { candidateContextDigest } from './ghx-candidate-context';

/**
 * THE one canonical mint authority for a genuinely-new resource.
 *
 * This is the extracted core of what Basic Price's `admitResourceForRow` always
 * did inline: after the identity authority is EXHAUSTED (the resource is truly
 * unknown, not merely a candidate), under a per-(workspace,type) advisory lock,
 * create exactly one `ResourceCatalog` row and one `ResourceSourceIdentity`
 * provenance row, in the caller's transaction. Extracting it here — in the
 * resource-catalog domain that owns both tables — is what makes it callable by
 * Basic Price, AHSP and BOQ WITHOUT any of them growing a second minting engine.
 *
 * It does not decide identity and it does not judge similarity: the ONE identity
 * kernel (via ResourceIdentityResolutionService) is re-asked under the lock and
 * must return exhausted, or nothing is minted. Candidates, AI confidence and
 * fuzzy matches never reach here — a caller that still has candidates has not
 * exhausted identity and is refused.
 */

/**
 * FNV-1a → signed int32, byte-identical to the helper Basic Price admission has
 * always used, kept here so BP admission and observed-resource admission
 * SERIALIZE ON THE SAME LOCK. The domain is (workspace, resourceType), never the
 * name: two spellings of one resource must not race past each other and both be
 * minted. RESOURCE NAME != RESOURCE IDENTITY holds in the lock too.
 */
export function resourceAdmissionLockKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** Namespace half of the advisory lock — "this is a resource admission". */
export const RESOURCE_ADMISSION_LOCK_NAMESPACE = resourceAdmissionLockKey(
  'RM03D1_REVIEWED_RESOURCE_ADMISSION',
);

/**
 * The identity authority still knows this resource (exact, candidate, or a prior
 * human decision), so minting a new one would be a duplicate. Carries the
 * resolution so a caller can render its own domain-specific refusal.
 */
export class ResourceAdmissionNotExhaustedError extends Error {
  constructor(readonly resolution: ResourceIdentityResolution) {
    super('RESOURCE_IDENTITY_NOT_EXHAUSTED');
    this.name = 'ResourceAdmissionNotExhaustedError';
  }
}

/** This exact source row is already bound to another catalog entry. */
export class ResourceProvenanceAlreadyBoundError extends Error {
  constructor() {
    super('RESOURCE_PROVENANCE_ALREADY_BOUND');
    this.name = 'ResourceProvenanceAlreadyBoundError';
  }
}

/**
 * Canonical shared memory (ResourceSourceIdentity) cannot be written without full
 * provenance — the source digest, file, parser, sheet, row and name cell are all
 * NOT NULL. A resource with no located source cannot be minted here; that is
 * honest, not a gap.
 */
export class ResourceAdmissionProvenanceIncompleteError extends Error {
  constructor(readonly missing: readonly string[]) {
    super('RESOURCE_ADMISSION_PROVENANCE_INCOMPLETE');
    this.name = 'ResourceAdmissionProvenanceIncompleteError';
  }
}

export interface ResourceAdmissionProvenance {
  sourceSha256: string;
  sourceFileName: string;
  parserContractVersion: string;
  sheetName: string;
  sourceRowNumber: number;
  sourceNameCellAddress: string;
  sourceCodeCellAddress?: string | null;
  sourceUnitCellAddress?: string | null;
}

/**
 * A resource a PERSON declared, with no document behind it.
 *
 * It is the same admission law as `AdmitObservedResourceInput` minus exactly one
 * thing: provenance. Manual AHSP and the Import confirmation screen both let an
 * editor state a resource the catalog does not have yet, and neither can produce
 * a source digest, sheet or cell for it, because no document ever stated it.
 * `ResourceSourceIdentity` is the shared memory of WHERE A DOCUMENT SPELLED a
 * resource, so a human-declared resource has nothing to write there and writes
 * nothing — the alternative would be inventing a file name, which is the one
 * thing provenance exists to prevent.
 */
export interface AdmitHumanDeclaredResourceInput {
  workspaceId: string;
  /** Exactly the words the person typed. Never normalized or tidied. */
  rawName: string;
  rawCode?: string | null;
  /** The person's own spelling of the unit, kept for the identity question. */
  rawUnit?: string | null;
  /** The section the person was working in; a LABOR row never mints MATERIAL. */
  resourceType: ResourceType;
  /** A canonical unit code the caller has already PROVEN via the Unit Kernel. */
  baseUnit: string;
  /**
   * OPTIONAL — the same examination channel `admitObservedResource` uses: the
   * person was shown the live nominations and refused every one of them. Absent,
   * this is plain machine exhaustion. It is what keeps Two-Door review lawful
   * here instead of bypassed.
   */
  examination?: {
    refusedCandidateIds: readonly string[];
    candidateContextDigest: string;
  };
}

export interface AdmitObservedResourceInput {
  workspaceId: string;
  /** The source facts, exactly as written. Never normalized or tidied. */
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  /** The source's own class; a LABOR source can never mint a MATERIAL. */
  resourceType: ResourceType;
  /** A canonical unit code the caller has already PROVEN via the Unit Kernel. */
  baseUnit: string;
  provenance: ResourceAdmissionProvenance;
  /**
   * OPTIONAL — a person examined the live nominations and refused every one of
   * them (see `isAdmissibleAfterExamination`). Absent, admission is exactly the
   * machine-exhaustion law it always was; Basic Price never sends it.
   */
  examination?: {
    refusedCandidateIds: readonly string[];
    candidateContextDigest: string;
  };
}

const PROVENANCE_REQUIRED: ReadonlyArray<keyof ResourceAdmissionProvenance> = [
  'sourceSha256',
  'sourceFileName',
  'parserContractVersion',
  'sheetName',
  'sourceRowNumber',
  'sourceNameCellAddress',
];

@Injectable()
export class ResourceAdmissionService {
  constructor(private readonly identity: ResourceIdentityResolutionService) {}

  /**
   * The SAME exhaustion predicate Basic Price admission used: truly not-found,
   * with no candidate, no resolved id and no authority. Anything short of this
   * still has an existing identity a human should choose instead of minting.
   */
  static isIdentityExhausted(identity: ResourceIdentityResolution): boolean {
    return (
      identity.status === 'UNRESOLVED' &&
      identity.reasonCodes.includes('RESOURCE_NOT_FOUND') &&
      identity.candidates.length === 0 &&
      identity.resolvedResourceCatalogId === null &&
      identity.authority === null
    );
  }

  /**
   * THE ONE ADMISSION SAFETY GATE, shared by both admission channels.
   *
   * Takes the per-(workspace,type) advisory lock and then re-asks the ONE
   * identity kernel UNDER it: either the machine exhausted identity by itself,
   * or a person refused exactly the live nominations — all of them name
   * similarity or machine-ruled-out — against the live candidate context. A
   * concurrent admission that created this resource makes it an exact match
   * here, so both roads refuse the duplicate.
   *
   * It is extracted rather than copied because a second copy would be a second
   * dedupe algorithm, and two algorithms drift. Document-born and human-declared
   * admission therefore serialize on the SAME lock and answer to the SAME
   * exhaustion proof; the only thing that differs between them is whether there
   * is a document to write provenance for afterwards.
   */
  private async lockAndProveAdmissible(
    tx: Prisma.TransactionClient,
    subject: {
      workspaceId: string;
      rawName: string;
      rawCode: string | null;
      rawUnit: string | null;
      resourceType: ResourceType;
      sourceSha256: string | null;
      examination?: {
        refusedCandidateIds: readonly string[];
        candidateContextDigest: string;
      };
    },
  ): Promise<void> {
    const lockKey = resourceAdmissionLockKey(
      `${subject.workspaceId}|${subject.resourceType}`,
    );
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${RESOURCE_ADMISSION_LOCK_NAMESPACE}::int4, ${lockKey}::int4)`,
    );

    const reference: RawResourceReference = {
      rawName: subject.rawName,
      rawCode: subject.rawCode,
      rawUnit: subject.rawUnit,
      resourceType: subject.resourceType,
      sourceSha256: subject.sourceSha256,
    };
    const evidence = await this.identity.loadEvidence(tx, subject.workspaceId);
    const resolution = await this.identity.resolve(evidence, reference, tx);
    const exhausted = ResourceAdmissionService.isIdentityExhausted(resolution);
    const examined =
      !exhausted &&
      subject.examination !== undefined &&
      isAdmissibleAfterExamination(
        resolution,
        subject.examination,
        candidateContextDigest(
          resolution.candidates.map((candidate) => ({
            resourceCatalogId: candidate.resourceCatalogId,
            name: candidate.name,
            type: candidate.type,
            baseUnit: candidate.baseUnit,
            specifications: candidate.specifications,
          })),
        ),
      );
    if (!exhausted && !examined) {
      throw new ResourceAdmissionNotExhaustedError(resolution);
    }
  }

  /**
   * Mint one canonical resource a PERSON declared, in the caller's transaction.
   * Returns the created ResourceCatalog row.
   *
   * THE DIFFERENCE FROM `admitObservedResource` IS EXACTLY ONE FACT: there is no
   * document, so no `ResourceSourceIdentity` is written. Everything that makes
   * admission safe is unchanged and shared — the same advisory lock, the same
   * identity kernel, the same exhaustion proof, the same examination channel that
   * keeps Two-Door review lawful. This is not a second mint authority; it is the
   * same authority answering the case where the evidence is a human instead of a
   * spreadsheet cell.
   *
   * WHY NO PROVENANCE ROW IS THE HONEST ANSWER: `ResourceSourceIdentity` records
   * where a DOCUMENT spelled a resource, and its six locator columns are NOT NULL
   * precisely so that claim can never be half-made. A resource nobody imported
   * has no digest, file, sheet, row or cell, and `resource_catalogs` requires no
   * provenance row at all — the foreign key runs one way only. So the resource is
   * minted with no source sighting rather than with an invented one.
   */
  async admitHumanDeclaredResource(
    tx: Prisma.TransactionClient,
    input: AdmitHumanDeclaredResourceInput,
  ) {
    await this.lockAndProveAdmissible(tx, {
      workspaceId: input.workspaceId,
      rawName: input.rawName,
      rawCode: input.rawCode ?? null,
      rawUnit: input.rawUnit ?? null,
      resourceType: input.resourceType,
      // No document was read, so the identity question carries no digest. This
      // is the same `null` every hand-built neutral observation already asks
      // with — not a missing value, an absent one.
      sourceSha256: null,
      examination: input.examination,
    });

    // Identity has already refused to bind this name to an existing row.
    // ResourceCatalog.code is unique per workspace, and one source code can
    // name several different resources. The code stays on the new row only
    // when no other row holds it. A different name that already holds it is
    // not reused and is not overwritten; this row is minted without that code.
    // The same normalized name of the same type is the same resource, so the
    // existing row is returned and no second insert is attempted. A different
    // type is a different resource even when the words match.
    const placement = await this.catalogCodePlacement(tx, input);
    if (placement.sameResource) return placement.sameResource;

    return tx.resourceCatalog.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.rawName,
        type: input.resourceType,
        baseUnit: input.baseUnit,
        code: placement.code,
      },
    });
  }

  /**
   * Mint one canonical resource from a proven, exhausted observation, in the
   * caller's transaction. Returns the created ResourceCatalog row.
   *
   * Order matters: lock → re-prove exhaustion → create catalog → create
   * provenance. If a concurrent admission created this resource while we waited
   * on the lock, the re-proof now sees it as a real candidate and refuses,
   * handing back the identity that already exists rather than a duplicate.
   */
  async admitObservedResource(
    tx: Prisma.TransactionClient,
    input: AdmitObservedResourceInput,
  ) {
    const missing = PROVENANCE_REQUIRED.filter((key) => {
      const value = input.provenance[key];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      throw new ResourceAdmissionProvenanceIncompleteError(missing);
    }

    await this.lockAndProveAdmissible(tx, {
      workspaceId: input.workspaceId,
      rawName: input.rawName,
      rawCode: input.rawCode ?? null,
      rawUnit: input.rawUnit ?? null,
      resourceType: input.resourceType,
      // The SAME question the queue asked, digest included. Admission re-proves
      // the verdict a person was shown, so it must be handed the same facts:
      // provenance.sourceSha256 is already mandatory input here, and leaving it
      // out made the two computations agree only while the document-code law
      // happened to be one-directional. That is an invariant, not a coincidence,
      // so it is stated rather than relied upon.
      sourceSha256: input.provenance.sourceSha256,
      examination: input.examination,
    });

    const catalog = await tx.resourceCatalog.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.rawName,
        type: input.resourceType,
        baseUnit: input.baseUnit,
        code: input.rawCode ?? null,
      },
    });

    try {
      await tx.resourceSourceIdentity.create({
        data: {
          resourceCatalogId: catalog.id,
          workspaceId: input.workspaceId,
          sourceSha256: input.provenance.sourceSha256,
          sourceFileName: input.provenance.sourceFileName,
          parserContractVersion: input.provenance.parserContractVersion,
          sheetName: input.provenance.sheetName,
          sourceRowNumber: input.provenance.sourceRowNumber,
          sourceSection: input.resourceType,
          sourceCodeCellAddress: input.provenance.sourceCodeCellAddress ?? null,
          sourceNameCellAddress: input.provenance.sourceNameCellAddress,
          sourceUnitCellAddress: input.provenance.sourceUnitCellAddress ?? null,
          rawCode: input.rawCode ?? null,
          rawName: input.rawName,
          rawUnit: input.rawUnit ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ResourceProvenanceAlreadyBoundError();
      }
      throw error;
    }

    return catalog;
  }

  /**
   * Catalog `code` is unique per workspace. A source code is not. When another
   * row already holds this code under a different name, the new resource is
   * still minted and the occupied code is left where it is. When the holder
   * is this same name and the same type, that row is the resource and no
   * insert is made.
   */
  private async catalogCodePlacement(
    tx: Prisma.TransactionClient,
    input: AdmitHumanDeclaredResourceInput,
  ): Promise<{
    code: string | null;
    sameResource: {
      id: string;
      name: string;
      code: string | null;
      type: ResourceType;
      baseUnit: string;
      workspaceId: string | null;
    } | null;
  }> {
    const code = input.rawCode?.trim() ? input.rawCode.trim() : null;
    if (code === null) return { code: null, sameResource: null };
    const existing = await tx.resourceCatalog.findFirst({
      where: { workspaceId: input.workspaceId, code },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        baseUnit: true,
        workspaceId: true,
      },
    });
    if (!existing) return { code, sameResource: null };
    if (
      existing.type === input.resourceType &&
      normalizeResourceName(existing.name) === normalizeResourceName(input.rawName)
    ) {
      return { code, sameResource: existing };
    }
    return { code: null, sameResource: null };
  }
}
