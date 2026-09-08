import { Injectable } from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import {
  RawResourceReference,
  ResourceIdentityResolution,
} from './resource-identity-resolution.kernel';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';

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

    const lockKey = resourceAdmissionLockKey(
      `${input.workspaceId}|${input.resourceType}`,
    );
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${RESOURCE_ADMISSION_LOCK_NAMESPACE}::int4, ${lockKey}::int4)`,
    );

    const reference: RawResourceReference = {
      rawName: input.rawName,
      rawCode: input.rawCode ?? null,
      rawUnit: input.rawUnit ?? null,
      resourceType: input.resourceType,
    };
    const evidence = await this.identity.loadEvidence(tx, input.workspaceId);
    const resolution = await this.identity.resolve(evidence, reference, tx);
    if (!ResourceAdmissionService.isIdentityExhausted(resolution)) {
      throw new ResourceAdmissionNotExhaustedError(resolution);
    }

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
}
