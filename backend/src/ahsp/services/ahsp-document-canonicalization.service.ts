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
import { AhspAuditService } from './ahsp-audit.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';
import {
  classifyAhspIdentity,
  type AhspIdentityRow,
} from '../document/ahsp-identity-classifier';

export const AHSP_DOCUMENT_MAX_BYTES = MAX_ENVELOPE_BYTES;

/** A human's decision on an AHSP the identity classifier flagged. Travels from Import Review to commit. */
export type AhspImportDecisionAction = 'USE_EXISTING' | 'KEEP_SEPARATE' | 'SKIP';
export interface AhspImportDecision {
  readonly workType: string;
  readonly methodName: string;
  readonly action: AhspImportDecisionAction;
}

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
    // The one AHSP normalization home — powers the POSSIBLY signal of the AHSP
    // identity classifier. No second normalizer or matcher is created here.
    private readonly norm: RealityNormalizationEngine,
    // The one AHSP provenance mechanism — records a human's duplicate decision.
    // No second audit/provenance store is created.
    private readonly audit: AhspAuditService,
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
    /** Human decisions from Import Review for AHSPs the classifier flagged. */
    decisions?: readonly AhspImportDecision[];
  }): Promise<AhspDocumentCommitResult> {
    return this.commit(await this.envelopeFromUpload(params), params.userId, params.decisions ?? []);
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
    decisions: readonly AhspImportDecision[] = [],
  ): Promise<AhspDocumentCommitResult> {
    const knowledge = await this.preview(envelope);
    const decisionByItem = this.decisionMap(decisions);
    const skipped: Array<AhspDocumentCommitResult['skipped'][number]> = [];
    const written: Array<AhspDocumentCommitResult['written'][number]> = [];
    const sightings: Prisma.ResourceSourceIdentityCreateManyInput[] = [];
    // Two provenance writes, two durability contracts, both written inline beside
    // the item they describe:
    //  - KEEP_SEPARATE: best-effort (its own catch), exactly like the observation
    //    and sighting writes below. The row already carries a durable AHSPCreated
    //    entry, so losing this note corrupts nothing and must never fail a commit.
    //  - USE_EXISTING: DURABLE (see recordUseExisting). Nothing is created for a
    //    use-existing decision, so that audit row is the ONLY trace that a human
    //    weighed a duplicate — its failure surfaces rather than being swallowed.
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

      const verdict = item.identityVerdict ?? 'DISTINCT';
      const decision = decisionByItem.get(
        item.workType.raw + '\u0000' + item.methodName.raw,
      );
      const primaryMatch = item.identityMatches?.[0];

      // IDENTICAL — an AHSP with this exact identity already holds it (a
      // soft-deleted twin counts, because it still occupies the @@unique index).
      // NEVER create: that is both the ONE-TRUTH law and the fix for the raw
      // P2002/500. Nothing is auto-merged — the human adopts the existing AHSP or
      // leaves it, and the choice is recorded, never inferred.
      if (verdict === 'IDENTICAL') {
        if (decision === 'USE_EXISTING') {
          await this.recordUseExisting(item, knowledge, userId);
        }
        skipped.push({
          workType: item.workType.raw,
          methodName: item.methodName.raw,
          reasonCodes: [AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY],
        });
        continue;
      }

      // POSSIBLY_IDENTICAL — a look-alike exists but identity is NOT proven. It
      // is never silently created: the human must explicitly keep it separate.
      // Absent that decision it is HELD (surfaced, not written, not lost) so the
      // human can still decide. similarity is evidence, never an auto-action.
      if (verdict === 'POSSIBLY_IDENTICAL' && decision !== 'KEEP_SEPARATE') {
        if (decision === 'USE_EXISTING') {
          await this.recordUseExisting(item, knowledge, userId);
        }
        skipped.push({
          workType: item.workType.raw,
          methodName: item.methodName.raw,
          reasonCodes: [AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH],
        });
        continue;
      }

      // DISTINCT, or POSSIBLY with an explicit human KEEP_SEPARATE (its identity
      // differs from every existing one, so a distinct row is lawful) — the
      // existing canonical write path, unchanged.
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
        if (verdict === 'POSSIBLY_IDENTICAL') {
          // Record that a possible twin was SHOWN and deliberately kept separate.
          // Written right beside the row it describes, so it can never be stranded
          // by an unrelated failure later in the loop. Best-effort: the row already
          // carries a durable AHSPCreated entry, so losing this note corrupts
          // nothing and must never fail an otherwise-good commit.
          await this.audit
            .logAction({
              ahspId: parent.id,
              action: 'AHSPImportKeptSeparate',
              who: userId,
              before: this.decisionProvenance(item, knowledge),
            })
            .catch(() => undefined);
        }
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

  /** Index human decisions by the work item's source-name identity (stable across the preview and commit uploads of the same file). Malformed entries are ignored, never trusted. */
  private decisionMap(
    decisions: readonly AhspImportDecision[],
  ): Map<string, AhspImportDecisionAction> {
    const map = new Map<string, AhspImportDecisionAction>();
    for (const decision of decisions) {
      if (
        decision &&
        typeof decision.workType === 'string' &&
        typeof decision.methodName === 'string' &&
        (decision.action === 'USE_EXISTING' ||
          decision.action === 'KEEP_SEPARATE' ||
          decision.action === 'SKIP')
      ) {
        map.set(decision.workType + '\u0000' + decision.methodName, decision.action);
      }
    }
    return map;
  }

  /**
   * Record a human's "use the one that already exists" decision — or record that it
   * could not be honoured. Nothing is ever created here.
   *
   * TWO RULES, enforced HERE because `decisions` is free-form request input and the
   * browser is never the authority on truth:
   *  - exactly ONE candidate. With several look-alikes SIMPROK cannot know which one
   *    the human meant, and adopting whichever sorted first would manufacture a
   *    certainty nobody stated.
   *  - the twin must be LIVE. A soft-deleted AHSP cannot be adopted here; reviving
   *    it is a separate, governed action.
   * When a rule refuses the choice, the ACT of choosing is still recorded, so a
   * human decision is never silently erased.
   *
   * DURABLE: awaited and uncaught. For a use-existing decision nothing is created,
   * so this row is the only trace that a human weighed a duplicate — losing it
   * silently is the one thing that must not happen. NOTE: commit() is not wrapped in
   * a transaction, so items written EARLIER in the loop stay written if this throws;
   * what is guaranteed is that the failure surfaces instead of being swallowed.
   */
  private async recordUseExisting(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
    userId: string,
  ): Promise<void> {
    const matches = item.identityMatches ?? [];
    const primaryMatch = matches[0];
    if (!primaryMatch) return;
    const honoured = matches.length === 1 && !primaryMatch.deleted;
    await this.audit.logAction({
      ahspId: primaryMatch.ahspId,
      action: honoured
        ? 'AHSPImportUsedExisting'
        : 'AHSPImportUsedExistingRefused',
      who: userId,
      before: this.decisionProvenance(item, knowledge),
    });
  }

  /** The reconstructable record of a duplicate decision for AHSPAuditLog: what was imported, from where, the verdict, and the AHSP(s) it was weighed against. */
  private decisionProvenance(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
  ): Record<string, unknown> {
    return {
      importedWorkType: item.workType?.raw ?? null,
      importedMethodName: item.methodName?.raw ?? null,
      sourceFileName: knowledge.source.fileName,
      sourceSha256: knowledge.source.contentDigestSha256,
      identityVerdict: item.identityVerdict ?? null,
      matches: (item.identityMatches ?? []).map((match) => ({
        ahspId: match.ahspId,
        workType: match.workType,
        methodName: match.methodName,
        signal: match.signal,
        deleted: match.deleted,
      })),
    };
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
    // The AHSP-whole identity surface, loaded ONCE per document (mirroring the
    // resource-identity load-once step above), never per work item — the
    // workspace's AHSPs plus the Official Repository, indexed for the classifier.
    const identitySurface = await this.ahspService.loadIdentitySurface(workspaceId);
    const workItems: AhspWorkItemKnowledge[] = [];
    for (const item of knowledge.workItems) {
      const resolved = await this.resolveWorkItem(item, loaded);
      workItems.push(this.classifyItemIdentity(resolved, identitySurface, workspaceId));
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

  /**
   * Attach the AHSP-WHOLE identity verdict to a work item via the pure
   * classifier and the surface loaded once. It reads only the item's own source
   * names (the document importer extracts no AHSP code), passes the ONE
   * normalization home's methods, and NEVER changes readiness — sameness and
   * readiness are different questions. DISTINCT (or an unnamed item) is left as
   * it was, so a reader with nothing to decide sees exactly what it saw before.
   */
  private classifyItemIdentity(
    item: AhspWorkItemKnowledge,
    surface: readonly AhspIdentityRow[],
    workspaceId: string,
  ): AhspWorkItemKnowledge {
    if (!item.workType || !item.methodName) return item;
    const classification = classifyAhspIdentity(
      { workspaceId, workType: item.workType.raw, methodName: item.methodName.raw },
      surface,
      {
        name: (raw) => this.norm.normalizeName(raw),
        code: (raw) => this.norm.normalizeCode(raw),
      },
    );
    if (classification.verdict === 'DISTINCT') {
      return { ...item, identityVerdict: 'DISTINCT', identityMatches: [] };
    }
    const matches =
      classification.verdict === 'IDENTICAL' && classification.exactMatch
        ? [classification.exactMatch]
        : classification.possibleMatches;
    return { ...item, identityVerdict: classification.verdict, identityMatches: matches };
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
