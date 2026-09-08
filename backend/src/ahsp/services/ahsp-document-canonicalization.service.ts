import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LocationType, MethodType, Prisma } from '@prisma/client';
import { IntakeError } from '../../universal-intake/intake-errors';
import { ReaderRegistry } from '../../universal-intake/readers/reader-registry';
import {
  MAX_ENVELOPE_BYTES,
  SourceEnvelope,
  sealSourceEnvelope,
} from '../../universal-intake/source-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';
import {
  UNIT_ALIAS_CONTEXT,
  UNIT_RESOLUTION_STATUS,
} from '../../unit-kernel/unit-kernel.contracts';
import {
  ResourceIdentityEvidence,
  ResourceIdentityResolutionService,
} from '../../resource-catalog/resource-identity-resolution.service';
import {
  ObserveResourceInput,
  ResourceObservationService,
} from '../../resource-catalog/resource-observation.service';
import { understandAhspDocument } from '../document/ahsp-document-understanding';
import {
  AHSP_DOCUMENT_REASON,
  AhspDocumentKnowledge,
  AhspDocumentReasonCode,
  AhspResourceGroup,
  AhspResourceKnowledge,
  AhspWorkItemKnowledge,
} from '../document/ahsp-document-knowledge';
import { AhspService } from './ahsp.service';
import { AhspVersionService } from './ahsp-version.service';

export const AHSP_DOCUMENT_MAX_BYTES = MAX_ENVELOPE_BYTES;

/** Schema-required parent identity when the document does not state method/location. Not an official fact. */
const AHSP_PARENT_IDENTITY_FILLER = {
  methodType: MethodType.OTHER,
  locationType: LocationType.OTHER,
} as const;

const GROUP_TO_CONTEXT: Record<
  AhspResourceGroup,
  (typeof UNIT_ALIAS_CONTEXT)[keyof typeof UNIT_ALIAS_CONTEXT]
> = {
  LABOR: UNIT_ALIAS_CONTEXT.LABOR,
  MATERIAL: UNIT_ALIAS_CONTEXT.MATERIAL,
  EQUIPMENT: UNIT_ALIAS_CONTEXT.EQUIPMENT,
};

export interface AhspDocumentCommitResult {
  readonly knowledge: AhspDocumentKnowledge;
  readonly written: ReadonlyArray<{
    readonly workType: string;
    readonly methodName: string;
    readonly ahspId: string;
    readonly versionId: string;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly workType: string | null;
    readonly methodName: string | null;
    readonly reasonCodes: readonly AhspDocumentReasonCode[];
  }>;
}

@Injectable()
export class AhspDocumentCanonicalizationService {
  constructor(
    private readonly ahspService: AhspService,
    private readonly versionService: AhspVersionService,
    private readonly units: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
    private readonly prisma: PrismaService,
    // Shared, domain-neutral home for a resource this import SAW but could not
    // prove. AHSP contributes observations; it does not own the lifecycle.
    private readonly observations: ResourceObservationService,
  ) {}

  private readonly readers = ReaderRegistry.default();

  sealUpload(params: {
    bytes: Buffer;
    fileName: string;
    mediaType: string | null;
    workspaceId: string;
    organizationId: string;
    actorAccountId: string;
  }): SourceEnvelope {
    return sealSourceEnvelope({
      ingestionChannel: 'USER_UPLOAD',
      fileName: params.fileName,
      mediaType: params.mediaType,
      bytes: params.bytes,
      workspaceId: params.workspaceId,
      organizationId: params.organizationId,
      actorAccountId: params.actorAccountId,
    });
  }

  async previewUpload(params: {
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined;
    workspaceId: string;
    actorAccountId: string;
  }): Promise<AhspDocumentKnowledge> {
    return this.preview(await this.envelopeFromUpload(params));
  }

  async commitUpload(params: {
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined;
    workspaceId: string;
    actorAccountId: string;
    userId: string;
  }): Promise<AhspDocumentCommitResult> {
    return this.commit(await this.envelopeFromUpload(params), params.userId);
  }

  async preview(envelope: SourceEnvelope): Promise<AhspDocumentKnowledge> {
    const read = await this.readers.read(envelope);
    return this.resolveKnowledge(understandAhspDocument(read, envelope), envelope.workspaceId);
  }

  private async envelopeFromUpload(params: {
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined;
    workspaceId: string;
    actorAccountId: string;
  }): Promise<SourceEnvelope> {
    if (!params.file?.buffer || !Buffer.isBuffer(params.file.buffer) || params.file.buffer.length === 0) {
      throw new BadRequestException('SOURCE_BYTES_REQUIRED');
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.sealUpload({
      bytes: params.file.buffer,
      fileName: params.file.originalname ?? 'ahsp.xlsx',
      mediaType: params.file.mimetype ?? null,
      workspaceId: params.workspaceId,
      organizationId: workspace.organizationId,
      actorAccountId: params.actorAccountId,
    });
  }

  async commit(
    envelope: SourceEnvelope,
    userId: string,
  ): Promise<AhspDocumentCommitResult> {
    const knowledge = await this.preview(envelope);
    const skipped: Array<AhspDocumentCommitResult['skipped'][number]> = [];
    const written: Array<AhspDocumentCommitResult['written'][number]> = [];
    const sightings: Prisma.ResourceSourceIdentityCreateManyInput[] = [];
    for (const item of knowledge.workItems) {
      if (item.status !== 'READY' || !item.workType || !item.methodName) {
        skipped.push({
          workType: item.workType?.raw ?? null,
          methodName: item.methodName?.raw ?? null,
          reasonCodes: item.reasonCodes.length
            ? item.reasonCodes
            : [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY],
        });
        continue;
      }
      try {
        const parent = await this.ahspService.create({
          workspaceId: envelope.workspaceId,
          workType: item.workType.raw,
          methodName: item.methodName.raw,
          methodType: AHSP_PARENT_IDENTITY_FILLER.methodType,
          locationType: AHSP_PARENT_IDENTITY_FILLER.locationType,
          userId,
        });
        const version = await this.versionService.createVersion(parent.id, {
          workspaceId: envelope.workspaceId,
          userId,
          outputUnit: item.resolvedOutputUnit ?? item.outputUnitRaw!.raw,
          regulationReference:
            item.regulationReference?.raw ??
            knowledge.document.regulationReference?.raw,
          resources: item.resources.map((resource) => ({
            resourceId: resource.resolvedResourceCatalogId!,
            resourceType: resource.group!,
            coefficient: resource.coefficient!,
            baseUnit: resource.resolvedBaseUnit ?? resource.rawUnit!,
          })),
        });
        written.push({
          workType: item.workType.raw,
          methodName: item.methodName.raw,
          ahspId: parent.id,
          versionId: version.id,
        });
        sightings.push(
          ...this.sightingsFor(item, knowledge, envelope.workspaceId),
        );
      } catch (error) {
        if (error instanceof ConflictException) {
          skipped.push({
            workType: item.workType.raw,
            methodName: item.methodName.raw,
            reasonCodes: [AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY],
          });
          continue;
        }
        throw error;
      }
    }
    // A resource this document SAW but could not prove is not lost. It is
    // persisted as a shared observation for later human curation — the exact
    // same lifecycle Basic Price feeds, through the one shared service. Proven
    // resources need no observation (they are already canonical); only the
    // unresolved ones are recorded, best-effort so a persistence hiccup never
    // fails an otherwise-good commit.
    await this.observeUnresolved(knowledge, envelope.workspaceId).catch(
      () => undefined,
    );
    // Every PROVED reading in an accepted analysis enriches the shared sighting
    // memory (ResourceSourceIdentity), so a spelling proved once is recognised
    // the next time. Best-effort, exactly like the observation above: learning
    // must never fail an otherwise-good commit.
    await this.rememberProvenReadings(sightings).catch(() => undefined);

    return { knowledge, written, skipped };
  }

  /**
   * Persist every resource the identity authority did NOT resolve as a shared
   * ObservedResource. Candidates travel as evidence, never as identity. Nothing
   * here mints or asserts anything; a human curates later.
   */
  private async observeUnresolved(
    knowledge: AhspDocumentKnowledge,
    workspaceId: string,
  ): Promise<void> {
    const inputs: ObserveResourceInput[] = [];
    for (const item of knowledge.workItems) {
      for (const resource of item.resources) {
        if (resource.resolvedResourceCatalogId) continue;
        if (!resource.rawName || !resource.group) continue;
        inputs.push({
          workspaceId,
          origin: 'AHSP_IMPORT',
          rawName: resource.rawName,
          rawCode: resource.rawCode,
          rawUnit: resource.rawUnit,
          resourceType: resource.group,
          candidates: resource.identityCandidates ?? [],
          provenance: {
            sourceSha256: knowledge.source.contentDigestSha256,
            sourceFileName: knowledge.source.fileName,
            parserContractVersion: knowledge.source.readerContractVersion,
            sheetName: resource.nameEvidence?.sheetName ?? null,
            sourceRowNumber: resource.nameEvidence?.rowNumber ?? null,
            sourceNameCellAddress: resource.nameEvidence?.locator ?? null,
            sourceCodeCellAddress: resource.codeEvidence?.locator ?? null,
            sourceUnitCellAddress: resource.unitEvidence?.locator ?? null,
          },
        });
      }
    }
    if (inputs.length > 0) await this.observations.observeMany(inputs);
  }

  /**
   * WHAT SIMPROK LEARNS FROM AN AHSP IT ACCEPTED.
   *
   * ResourceSourceIdentity is the platform's existing memory of how the real
   * world SPELLS a resource it has already proved: the Basic Price intake and
   * the catalogue bootstrap both write it, and the identity kernel reads it back
   * as SOURCE_SIGHTING_NAME_MATCH / SOURCE_CODE_MATCH when nominating candidates
   * for a name it has not seen exactly before.
   *
   * The AHSP door only ever READ that memory. Every official analysis the Owner
   * imported taught the platform nothing, so an abbreviation or a variant
   * spelling proved in one AHSP was a stranger again in the next. This is the
   * missing wire, not a new mechanism: same table, same contract, same fields as
   * the writer Basic Price already uses.
   *
   * ONLY PROVED READINGS ARE RECORDED. The row's catalogue id is the one the
   * identity kernel resolved, so nothing here asserts an identity — it records
   * that a proved identity was written this way, in this file, at this row.
   */
  private sightingsFor(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
    workspaceId: string,
  ): Prisma.ResourceSourceIdentityCreateManyInput[] {
    const rows: Prisma.ResourceSourceIdentityCreateManyInput[] = [];
    for (const resource of item.resources) {
      const name = resource.nameEvidence;
      if (
        !resource.resolvedResourceCatalogId ||
        !resource.group ||
        !resource.rawName ||
        !name
      ) {
        continue;
      }
      rows.push({
        resourceCatalogId: resource.resolvedResourceCatalogId,
        workspaceId,
        sourceSha256: knowledge.source.contentDigestSha256,
        sourceFileName: knowledge.source.fileName,
        parserContractVersion: knowledge.source.readerContractVersion,
        sheetName: name.sheetName,
        sourceRowNumber: name.rowNumber,
        sourceSection: resource.group,
        sourceCodeCellAddress: resource.codeEvidence?.locator ?? null,
        sourceNameCellAddress: name.locator,
        sourceUnitCellAddress: resource.unitEvidence?.locator ?? null,
        rawCode: resource.rawCode,
        rawName: resource.rawName,
        rawUnit: resource.rawUnit,
      });
    }
    return rows;
  }

  /**
   * Additive only, and never at the canonical write's expense.
   *
   * The memory is keyed on workspace + file digest + sheet + row + parser, so
   * re-importing the same document must not fail: `skipDuplicates` leaves an
   * existing reading exactly as it stands rather than rebinding it. A sighting
   * is EVIDENCE the kernel weighs, never authority, so declining to overwrite
   * one costs a little learning and can corrupt nothing.
   */
  private async rememberProvenReadings(
    rows: Prisma.ResourceSourceIdentityCreateManyInput[],
  ): Promise<void> {
    if (rows.length === 0) return;
    // One document can read the same row only once, but two work items may
    // legitimately quote it; the key is unique, so the duplicate is dropped here
    // rather than left for the database to reject.
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
      const key = [
        row.workspaceId,
        row.sourceSha256,
        row.sheetName,
        row.sourceRowNumber,
        row.parserContractVersion,
      ].join(' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await this.prisma.resourceSourceIdentity.createMany({
      data: unique,
      skipDuplicates: true,
    });
  }

  private async resolveKnowledge(
    knowledge: AhspDocumentKnowledge,
    workspaceId: string,
  ): Promise<AhspDocumentKnowledge> {
    if (knowledge.workItems.length === 0) return knowledge;
    const loaded = await this.identity.loadEvidence(this.prisma, workspaceId);
    const workItems: AhspWorkItemKnowledge[] = [];
    for (const item of knowledge.workItems) {
      workItems.push(await this.resolveWorkItem(item, loaded));
    }
    const anyReady = workItems.some((item) => item.status === 'READY');
    return {
      ...knowledge,
      workItems,
      status:
        knowledge.status === 'STRUCTURE_UNSUPPORTED'
          ? knowledge.status
          : anyReady
            ? 'READY'
            : 'UNRESOLVED',
    };
  }

  private async resolveWorkItem(
    item: AhspWorkItemKnowledge,
    evidence: ResourceIdentityEvidence,
  ): Promise<AhspWorkItemKnowledge> {
    const reasons: AhspDocumentReasonCode[] = [...item.reasonCodes];
    let resolvedOutputUnit: string | null = null;
    if (item.outputUnitRaw) {
      const unit = await this.units.resolve(
        item.outputUnitRaw.raw,
        item.outputUnitRaw.raw,
      );
      if (unit.status !== UNIT_RESOLUTION_STATUS.RESOLVED || !unit.sourceUnitDefinition) {
        reasons.push(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
      } else {
        resolvedOutputUnit = item.outputUnitRaw.raw;
      }
    }
    const resources: AhspResourceKnowledge[] = [];
    for (const resource of item.resources) {
      resources.push(await this.resolveResource(resource, evidence));
    }
    // EVERY reason a component was held back travels up to the work item.
    //
    // This used to be one blanket "any resource is not READY -> the resources
    // are unresolved", which told the reader the wrong thing about a component
    // whose UNIT was the problem. Naming the codes fixes that, but it must name
    // ALL of them: listing only the two identity codes left an item whose
    // component unit was unknown carrying no reason whatsoever, and commit()
    // then reported it as generic ambiguity — the one thing it was not. The
    // reader is told which of the three questions is still open, in the source's
    // own terms, and never asked to accept a guess in place of an answer.
    for (const code of [
      AHSP_DOCUMENT_REASON.RESOURCE_CANDIDATES_FOUND,
      AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
      AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED,
    ] as const) {
      if (resources.some((resource) => resource.reasonCodes.includes(code))) {
        reasons.push(code);
      }
    }
    const unique = [...new Set(reasons)];
    const ready =
      item.workType !== null &&
      item.methodName !== null &&
      resolvedOutputUnit !== null &&
      resources.length > 0 &&
      resources.every((resource) => resource.status === 'READY') &&
      unique.filter((code) => code !== AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN)
        .length === 0;
    return {
      ...item,
      resolvedOutputUnit,
      resources,
      reasonCodes: unique,
      status: ready ? 'READY' : 'UNRESOLVED',
    };
  }

  private async resolveResource(
    resource: AhspResourceKnowledge,
    evidence: ResourceIdentityEvidence,
  ): Promise<AhspResourceKnowledge> {
    // A component the source never named cannot be searched for at all. That is
    // the ONLY thing that stops the investigation before it starts.
    if (!resource.rawName || !resource.group) {
      return resource;
    }

    const reasonCodes = [...resource.reasonCodes];
    const unitResolved =
      resource.rawUnit !== null &&
      (
        await this.units.resolve(
          resource.rawUnit,
          resource.rawUnit,
          undefined,
          GROUP_TO_CONTEXT[resource.group],
        )
      ).status === UNIT_RESOLUTION_STATUS.RESOLVED;
    if (resource.rawUnit !== null && !unitResolved) {
      reasonCodes.push(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
    }

    // WHY THE SEARCH CONTINUES PAST AN UNKNOWN UNIT.
    //
    // This used to return here, so a component whose unit spelling SIMPROK had
    // never seen was never even asked about — its identity went unsearched, its
    // candidates undiscovered, and the reader was left with nothing to act on
    // for a resource the catalogue may well already hold. "Which resource is
    // this" and "what measure is it in" are different questions; failing the
    // second is no reason to stop asking the first. Nothing below is claimed:
    // an unproven unit still blocks READY, so no such component can be written.
    const identity = await this.identity.resolve(evidence, {
      rawName: resource.rawName,
      rawCode: resource.rawCode,
      rawUnit: resource.rawUnit,
      resourceType: resource.group,
    });
    const identityCandidates = [
      ...new Set(
        (identity.candidates ?? [])
          .map((candidate) => candidate.name.trim())
          .filter((name) => name.length > 0),
      ),
    ];
    if (identity.status === 'RESOLVED' && identity.resolvedResourceCatalogId) {
      // Identity proved. The base unit is only carried when the Unit authority
      // proved it too — knowing WHICH resource this is never licenses asserting
      // what measure it is in.
      return {
        ...resource,
        status: unitResolved ? resource.status : 'UNRESOLVED',
        reasonCodes,
        resolvedResourceCatalogId: identity.resolvedResourceCatalogId,
        resolvedBaseUnit: unitResolved ? resource.rawUnit : null,
        identityCandidates: [],
      };
    }
    // WHY THE CONDITION IS "candidates exist", NOT "status is NEEDS_REVIEW".
    //
    // The identity kernel also returns candidates on UNRESOLVED verdicts —
    // SPECIFICATION_CONFLICT and RESOURCE_TYPE_MISMATCH both name the rows they
    // held back. Keying this branch on NEEDS_REVIEW alone sent those through the
    // "nothing matched" wording below, so the reader was told SIMPROK found no
    // such resource when it had in fact found several and could say which.
    // Whether SIMPROK has something to show is a question about candidates, so
    // it is asked of the candidates.
    if (identityCandidates.length > 0) {
      return {
        ...resource,
        status: 'UNRESOLVED',
        identityCandidates,
        reasonCodes: [
          ...reasonCodes,
          AHSP_DOCUMENT_REASON.RESOURCE_CANDIDATES_FOUND,
        ],
      };
    }
    // Searched and found nothing this catalogue can offer. The component stays
    // in the knowledge with its evidence: not proved is not "does not exist".
    return {
      ...resource,
      status: 'UNRESOLVED',
      identityCandidates,
      reasonCodes: [...reasonCodes, AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED],
    };
  }
}

export function isAhspIntakeError(error: unknown): error is IntakeError {
  return error instanceof IntakeError;
}
