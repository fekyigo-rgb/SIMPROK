import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ImportStatus, LocationType, MethodType, Prisma } from '@prisma/client';
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
  observedSourceRowKey,
} from '../../resource-catalog/resource-observation.service';
import { identicalQuestionKey } from '../../resource-catalog/identical-question-key';
import { isResourceCatalogIdShape } from '../../resource-catalog/resource-identity-resolution.kernel';
import {
  understandAhspDocument,
  withTitleOutputUnitStatement,
} from '../document/ahsp-document-understanding';
import {
  AHSP_DOCUMENT_CONTRACT_VERSION,
  AHSP_DOCUMENT_REASON,
  AhspDocumentKnowledge,
  AhspDocumentReasonCode,
  AhspResourceGroup,
  AhspResourceKnowledge,
  AhspSourceLocator,
  AhspWorkItemAdmission,
  AhspWorkItemKnowledge,
} from '../document/ahsp-document-knowledge';
// Read, never re-implemented: the ONE eligibility law for a usable recipe, and the
// policy under which the consuming resolver consults governed identity decisions.
import {
  buildEligibleAhspVersionWhere,
  pickCurrentApplicableAhspVersions,
} from '../../project-ahsp/ahsp-eligibility.policy';
import { E1A_RESOLUTION_POLICY_VERSION } from '../../project-ahsp/ahsp-resource-resolution.orchestrator';
import { AhspService } from './ahsp.service';
import { AhspVersionService } from './ahsp-version.service';
import { AhspAuditService } from './ahsp-audit.service';
import {
  AhspImportJournalLine,
  AhspImportLineAlreadySettledError,
  AhspImportLineOutcome,
  AhspImportLockedLine,
  AhspImportService,
} from './ahsp-import.service';
import {
  ARCHIVE_SOURCE_NOT_RETAINED,
  BasicPriceSourceArchiveService,
} from '../../basic-price/basic-price-source-archive.service';
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

/**
 * The reasons that mean "the recipe is whole; only a component's catalogue
 * identity is still open". Anything else keeps an item HELD.
 */
const IDENTITY_ONLY_REASONS: ReadonlySet<AhspDocumentReasonCode> = new Set([
  AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
  AHSP_DOCUMENT_REASON.RESOURCE_CANDIDATES_FOUND,
]);

/**
 * One work item's canonical write — or one recorded duplicate decision — is
 * whole-or-nothing. The same budget the observation lifecycle uses for its own
 * interactive transactions.
 */
const ITEM_TRANSACTION = { timeout: 20_000, maxWait: 20_000 } as const;

/** What one evaluation of a document (or of a job's held lines) did, counted once. */
export interface AhspImportIntakeSummary {
  /** Work items evaluated — each one already has a durable intake line. */
  readonly evaluated: number;
  /** Written with every fact proved: usable now. */
  readonly ready: number;
  /** Written; at least one component keeps the source's wording while its catalogue identity is pending. */
  readonly identityPending: number;
  /** An AHSP with this identity already represents the item; nothing new was written. */
  readonly alreadyPresent: number;
  /**
   * This intake line was already settled by an earlier evaluation, so THIS
   * request did nothing to it: no AHSP, no adoption, no second record. Its
   * recorded outcome stands. A replay is counted here and nowhere else — never
   * as something newly written or newly adopted.
   */
  readonly alreadyProcessed: number;
  /** Kept, not written: a fact the recipe needs is missing, unproved, or awaits a decision. */
  readonly held: number;
  /** The item's write failed and wrote nothing; its line stays open for the next evaluation. */
  readonly failed: number;
}

/**
 * What ONE evaluation did to ONE intake line. Each meaning stays separate: a
 * replay that changed nothing must never be counted — or worded — as a write,
 * an adoption, or a fresh hold.
 */
type AhspImportItemOutcome =
  | {
      readonly kind: 'WRITTEN';
      readonly ahspId: string;
      readonly versionId: string;
    }
  | {
      readonly kind: 'ALREADY_PRESENT';
      readonly reasonCodes: readonly AhspDocumentReasonCode[];
    }
  | {
      readonly kind: 'ALREADY_PROCESSED';
      readonly reasonCodes: readonly AhspDocumentReasonCode[];
    }
  | {
      readonly kind: 'HELD';
      readonly reasonCodes: readonly AhspDocumentReasonCode[];
    }
  | { readonly kind: 'FAILED' }
  /** The line is not (or no longer) one this workspace can see. */
  | { readonly kind: 'UNREACHABLE' };

export interface AhspDocumentCommitResult {
  readonly knowledge: AhspDocumentKnowledge;
  /** The durable intake journal this evaluation belongs to. */
  readonly importJobId: string;
  readonly summary: AhspImportIntakeSummary;
  readonly written: ReadonlyArray<{
    readonly workType: string;
    readonly methodName: string;
    readonly ahspId: string;
    readonly versionId: string;
    readonly admission: Exclude<AhspWorkItemAdmission, 'HELD'>;
    /** Components written with the source's wording because their identity is not proved yet. */
    readonly identityPendingResources: number;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly workType: string | null;
    readonly methodName: string | null;
    readonly reasonCodes: readonly AhspDocumentReasonCode[];
  }>;
  readonly failed: ReadonlyArray<{
    readonly workType: string | null;
    readonly methodName: string | null;
    readonly lineNumber: number;
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
    // IMPORT-SEAM-02 — the durable intake journal on the existing AHSP import
    // tables. It holds what a document was read into; it never resolves or writes
    // a canonical AHSP.
    private readonly journal: AhspImportService,
    /**
     * C1 — the existing content-addressed source archive. Domain-neutral given
     * (workspaceId, digest, bytes); see ahsp.module.ts for why this class and
     * not a second one.
     */
    private readonly sourceArchive: BasicPriceSourceArchiveService,
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

  /**
   * C1 — THE SOURCE OF A SAVED IMPORT, READ BACK FROM THE JOB ALONE.
   *
   * Retaining bytes nothing can reach is only half a memory. An import job
   * keeps the document's digest and no storage reference, so until now the
   * artifact this service retained was unreachable from the import that named
   * it — the file was kept and lost at the same time.
   *
   * Composed from the two existing owners rather than a third: the journal says
   * WHICH document a job is about, the archive says where a workspace's bytes
   * for that document live and hands them back verified. This service holds
   * both already, so no new dependency, column or storage path is introduced.
   *
   * It answers only about this workspace's own job, and it distinguishes what
   * must stay distinguishable: a job that names no document at all, a document
   * whose bytes were never retained (imports saved before the bytes were kept
   * are exactly this), and bytes that are there but do not verify — the last
   * raises from the archive rather than answering with something that is not
   * the document.
   */
  async sourceBytesOfImportJob(params: {
    workspaceId: string;
    importJobId: string;
  }): Promise<
    | { status: 'FOUND'; bytes: Buffer; sourceFileName: string | null; contentDigestSha256: string }
    | { status: 'JOB_NOT_FOUND' }
    | { status: 'DOCUMENT_NOT_NAMED' }
    | { status: 'NOT_RETAINED' }
  > {
    const identity = await this.journal.documentIdentityOfJob(params);
    if (!identity) return { status: 'JOB_NOT_FOUND' };
    if (!identity.sourceSha256) return { status: 'DOCUMENT_NOT_NAMED' };
    try {
      const bytes = await this.sourceArchive.readForDocument({
        workspaceId: params.workspaceId,
        contentDigestSha256: identity.sourceSha256,
      });
      return {
        status: 'FOUND',
        bytes,
        sourceFileName: identity.sourceFileName,
        contentDigestSha256: identity.sourceSha256.toUpperCase(),
      };
    } catch (error) {
      // An absence is an answer; a fault is not, and must not be flattened into
      // one — the archive already tells them apart, so only ABSENT is caught.
      if (
        error instanceof Error &&
        error.message.startsWith(ARCHIVE_SOURCE_NOT_RETAINED)
      ) {
        return { status: 'NOT_RETAINED' };
      }
      throw error;
    }
  }

  /**
   * IMPORT IS RECEIVING INFORMATION: read → understand → CAPTURE → resolve → write.
   *
   * Capture comes before any decision. Every work item the document was read
   * into becomes a durable intake line exactly as it was understood, so nothing
   * the source stated depends on this request surviving, and nothing that cannot
   * be written yet is lost. Only then is the knowledge resolved against today's
   * authorities and written through the existing writers.
   */
  async commit(
    envelope: SourceEnvelope,
    userId: string,
    decisions: readonly AhspImportDecision[] = [],
  ): Promise<AhspDocumentCommitResult> {
    /**
     * C1 — THE BYTES ARE KEPT BEFORE SIMPROK TRIES TO UNDERSTAND THEM.
     *
     * The journal row this commit will write names a digest. Nothing used to
     * keep the bytes behind it, so an AHSPImportJob could name a source SIMPROK
     * could not produce, and a document's context became unrecoverable the
     * moment the request ended.
     *
     * This sits BEFORE the reader, not merely before the journal. A document
     * SIMPROK cannot read is exactly the document worth keeping: reading it
     * later, better, is possible only if the bytes survived the attempt, and a
     * reader that throws would otherwise take the Owner's file down with it.
     * Retaining is not a claim that anything was understood — no job, no line
     * and no AHSP is created here, and a failed read still fails the commit.
     *
     * The archive is content addressed and verifies the declared digest instead
     * of trusting it, so the same document sent twice resolves to the same
     * artifact rather than a duplicate: retry and re-upload are idempotent here.
     */
    await this.sourceArchive.retain({
      workspaceId: envelope.workspaceId,
      contentDigestSha256: envelope.contentDigestSha256,
      bytes: envelope.bytes,
    });
    const understood = understandAhspDocument(
      await this.readers.read(envelope),
      envelope,
    );
    const journal = await this.journal.recordDocument({
      workspaceId: envelope.workspaceId,
      userId,
      knowledge: understood,
    });
    const knowledge = await this.resolveKnowledge(
      understood,
      envelope.workspaceId,
    );
    return this.commitKnowledge(knowledge, {
      workspaceId: envelope.workspaceId,
      userId,
      decisions,
      importJobId: journal.importJobId,
      lines: journal.lines,
    });
  }

  /**
   * Continue an import WITHOUT the file. The held lines are read back exactly as
   * they were understood, asked again of today's identity, unit and sameness
   * authorities, and written through the same path a fresh commit uses. Items
   * still missing a fact stay held, unchanged; nothing is guessed.
   */
  async continueImportJob(params: {
    workspaceId: string;
    importJobId: string;
    userId: string;
    decisions?: readonly AhspImportDecision[];
  }): Promise<AhspDocumentCommitResult> {
    const held = await this.journal.loadHeld(
      params.workspaceId,
      params.importJobId,
    );
    // Stored knowledge is trusted only under the contract it was understood with.
    if (held.knowledgeContractVersion !== AHSP_DOCUMENT_CONTRACT_VERSION) {
      throw new ConflictException('AHSP_IMPORT_KNOWLEDGE_CONTRACT_CHANGED');
    }
    // A line understood before work titles were read is completed with ONLY the
    // title statement it lacks, read from the title it kept — never from the file.
    const understood: AhspDocumentKnowledge = {
      ...held.envelope,
      workItems: held.lines.map((line) =>
        withTitleOutputUnitStatement(line.knowledge),
      ),
    };
    const knowledge = await this.resolveKnowledge(
      understood,
      params.workspaceId,
    );
    return this.commitKnowledge(knowledge, {
      workspaceId: params.workspaceId,
      userId: params.userId,
      decisions: params.decisions ?? [],
      importJobId: params.importJobId,
      lines: held.lines,
    });
  }

  /**
   * The workspace's recent imports and every line still waiting — a read. A line
   * held for a possible twin carries the comparison the preview showed, asked
   * again of today's AHSPs through the same classifier, so the reader can still
   * decide after leaving the page — without the file. Nothing is decided here.
   *
   * AHSP COMPLETION — and what each import still needs, asked of TODAY's
   * authorities from the facts the document stated, never from the evaluation
   * that settled a line (those reasons go stale the moment a person curates):
   *  - a unit spelling waited for is asked of the Unit Kernel once per spelling
   *    and class; a line whose units are all known now is worth checking again,
   *    and every other line names the spellings it still waits for;
   *  - a line held on a source contradiction names what each statement says;
   *  - a line understood before work titles were read, whose kept title states
   *    its output unit, is worth checking again (the check reads that title);
   *  - OPEN QUESTIONS are the curation queue's own projection, once per exact
   *    question — a count of what is asked, never proof of what is identified;
   *  - a saved line is COMPLETE FOR THE AHSP STAGE only when the recipe it points
   *    to passes the resolver that consumes it (see recipeStates). Pricing is a
   *    later question, and is not asked here.
   */
  async listImportJobs(
    workspaceId: string,
    options: { cursor?: string | null } = {},
  ) {
    const page = await this.journal.listDocuments(workspaceId, {
      cursor: options.cursor ?? null,
    });
    const jobs = page.jobs;
    // The way on travels with the page, so "nothing waiting here" is never read
    // as "nothing waiting anywhere".
    const nextPage = { nextCursor: page.nextCursor, hasMore: page.hasMore };
    if (jobs.length === 0) return { items: [], ...nextPage };
    const awaitsSameness = (line: { reasonCodes: readonly string[] }) =>
      line.reasonCodes.includes(AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH);
    const surface = jobs.some((job) => job.waiting.some(awaitsSameness))
      ? await this.ahspService.loadIdentitySurface(workspaceId)
      : null;
    const stored = await this.journal.loadCompletionLines(
      workspaceId,
      jobs.map((job) => job.importJobId),
    );
    const openQuestions = await this.observations.openQuestionsBySource(
      workspaceId,
      [
        ...new Set(
          jobs
            .map((job) => job.sourceSha256)
            .filter((sha): sha is string => Boolean(sha)),
        ),
      ],
    );
    // One Unit Kernel question per spelling (and class), however many lines ask it.
    const unitAnswers = new Map<string, Promise<boolean>>();
    const unitProvedToday = (raw: string, group: AhspResourceGroup | null) => {
      const key = JSON.stringify([group, raw]);
      const known = unitAnswers.get(key) ?? this.unitProved(raw, group);
      unitAnswers.set(key, known);
      return known;
    };
    const definitionAnswers = new Map<string, Promise<string | null>>();
    const definitionToday = (raw: string) => {
      const known =
        definitionAnswers.get(raw) ?? this.outputUnitDefinition(raw);
      definitionAnswers.set(raw, known);
      return known;
    };
    const completed = stored.filter(
      (line) => line.status === ImportStatus.COMPLETED,
    );
    const recipes = await this.recipeStates(
      workspaceId,
      completed,
      unitProvedToday,
    );

    const items = await Promise.all(
      jobs.map(async (job) => {
        const lines = stored.filter(
          (line) => line.importJobId === job.importJobId,
        );
        const open = (job.sourceSha256 &&
          openQuestions.get(job.sourceSha256)) || {
          keys: new Set<string>(),
          uses: 0,
        };
        // A saved line counts ONCE: a recipe that cannot be used, a document that
        // states another output unit than the one saved, an identity the consumer
        // cannot prove yet — or complete for the AHSP stage.
        let complete = 0;
        let awaitingIdentity = 0;
        let recipeNotUsable = 0;
        const writtenUnitQuestions: Array<{
          lineNumber: number;
          workType: string | null;
          methodName: string | null;
          statedOutputUnits: string[];
          provenDifferent: boolean;
        }> = [];
        for (const line of lines) {
          if (line.status !== ImportStatus.COMPLETED) continue;
          const recipe = recipes.get(line.id) ?? 'NOT_USABLE';
          if (recipe === 'NOT_USABLE') {
            recipeNotUsable += 1;
            continue;
          }
          const adapted = withTitleOutputUnitStatement(line.knowledge);
          if (
            adapted !== line.knowledge &&
            adapted.outputUnitStatements &&
            adapted.reasonCodes.includes(
              AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
            )
          ) {
            const verdict = await this.outputUnitStatementsVerdict(
              adapted.outputUnitStatements,
              definitionToday,
            );
            if (verdict !== 'SAME') {
              writtenUnitQuestions.push({
                lineNumber: line.lineNumber,
                workType: line.knowledge.workType?.raw ?? null,
                methodName: line.knowledge.methodName?.raw ?? null,
                statedOutputUnits: adapted.outputUnitStatements.map(
                  (statement) => statement.raw,
                ),
                provenDifferent: verdict === 'DIFFERENT',
              });
              continue;
            }
          }
          if (recipe === 'AWAITING_IDENTITY') awaitingIdentity += 1;
          else complete += 1;
        }
        const waiting = await Promise.all(
          job.waiting.map(async (line) => {
            const kept = lines.find(
              (candidate) => candidate.lineNumber === line.lineNumber,
            )?.knowledge;
            const knowledge = kept && withTitleOutputUnitStatement(kept);
            return {
              ...line,
              ...(surface &&
              awaitsSameness(line) &&
              line.workType !== null &&
              line.methodName !== null
                ? this.identityOf(
                    line.workType,
                    line.methodName,
                    surface,
                    workspaceId,
                  )
                : {}),
              ...(knowledge !== kept ? { readingUpdated: true as const } : {}),
              ...(knowledge &&
              line.reasonCodes.includes(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED)
                ? await this.unitsWaitedFor(knowledge, unitProvedToday)
                : {}),
              ...(knowledge?.outputUnitStatements &&
              line.reasonCodes.includes(
                AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
              )
                ? {
                    statedOutputUnits: knowledge.outputUnitStatements.map(
                      (statement) => statement.raw,
                    ),
                  }
                : {}),
            };
          }),
        );
        return {
          importJobId: job.importJobId,
          sourceFileName: job.sourceFileName,
          status: job.status,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          counts: job.counts,
          completion: {
            complete,
            awaitingIdentity,
            recipeNotUsable,
            writtenUnitQuestions,
            identityQuestions: { questions: open.keys.size, uses: open.uses },
          },
          waiting,
        };
      }),
    );
    return { items, ...nextPage };
  }

  /**
   * COMPLETE FOR THE AHSP STAGE — asked of the recipe a saved line points to, the
   * way the resolver that CONSUMES that recipe asks (AhspResourceResolutionOrchestrator),
   * and never read off the curation queue: a question that left the queue is not
   * an identity anyone can use, and a component that was never observed is not
   * one either.
   *  - the recipe is the version the import wrote; for a line represented by an
   *    AHSP SIMPROK already held, the version that AHSP offers today under the ONE
   *    eligibility law (buildEligibleAhspVersionWhere, then the current applicable
   *    snapshot). No such version, or a written version no longer lawful: NOT_USABLE;
   *  - its output unit and every component unit must be proved by the Unit Kernel,
   *    and every coefficient must be positive — otherwise NOT_USABLE;
   *  - every component must be IDENTIFIED by the Resource Identity authority from
   *    the consumer's own facts, with the governed source-fact decisions (GHX) and
   *    approved exact-question answers (IQL) it consults — otherwise
   *    AWAITING_IDENTITY. ONE evidence load serves every recipe listed.
   * Nothing is written, and whether a Basic Price exists is not asked.
   */
  private async recipeStates(
    workspaceId: string,
    lines: ReadonlyArray<{
      id: string;
      ahspId: string | null;
      ahspVersionId: string | null;
    }>,
    unitProvedToday: (
      raw: string,
      group: AhspResourceGroup | null,
    ) => Promise<boolean>,
  ): Promise<Map<string, 'COMPLETE' | 'AWAITING_IDENTITY' | 'NOT_USABLE'>> {
    const states = new Map<
      string,
      'COMPLETE' | 'AWAITING_IDENTITY' | 'NOT_USABLE'
    >();
    if (lines.length === 0) return states;
    const eligible = buildEligibleAhspVersionWhere(workspaceId, new Date());
    const recipeSelect = {
      id: true,
      versionNumber: true,
      outputUnit: true,
      ahsp: { select: { id: true } },
      resources: {
        select: {
          id: true,
          resourceId: true,
          resourceType: true,
          coefficient: true,
          baseUnit: true,
          rawName: true,
          rawCode: true,
          rawUnit: true,
        },
      },
    } as const;
    const writtenIds = [
      ...new Set(
        lines.flatMap((line) =>
          line.ahspVersionId ? [line.ahspVersionId] : [],
        ),
      ),
    ];
    const heldIds = [
      ...new Set(
        lines.flatMap((line) =>
          !line.ahspVersionId && line.ahspId ? [line.ahspId] : [],
        ),
      ),
    ];
    const written =
      writtenIds.length > 0
        ? await this.prisma.aHSPVersion.findMany({
            where: { AND: [{ id: { in: writtenIds } }, eligible] },
            select: recipeSelect,
          })
        : [];
    const offered =
      heldIds.length > 0
        ? pickCurrentApplicableAhspVersions(
            await this.prisma.aHSPVersion.findMany({
              where: { AND: [{ ahspId: { in: heldIds } }, eligible] },
              select: recipeSelect,
            }),
          )
        : [];
    const writtenById = new Map(
      written.map((version) => [version.id, version]),
    );
    const offeredByParent = new Map(
      offered.map((version) => [version.ahsp.id, version]),
    );
    const recipes = [...written, ...offered];
    const resources = recipes.flatMap((version) => version.resources);
    const factsOf = (resource: (typeof resources)[number]) => {
      // The consumer's own derivation (orchestrator sourceFacts), pinned to it by
      // the consumer-equivalence spec so the two cannot drift apart silently.
      const resourceCatalogId = isResourceCatalogIdShape(resource.resourceId)
        ? resource.resourceId
        : null;
      return {
        rawName:
          resource.rawName ??
          (resourceCatalogId === null ? resource.resourceId : ''),
        rawCode: resource.rawCode ?? null,
        rawUnit: resource.rawUnit ?? resource.baseUnit,
        resourceType: resource.resourceType,
        resourceCatalogId,
      };
    };
    const evidence =
      resources.length > 0
        ? await this.identity.loadEvidence(
            this.prisma,
            workspaceId,
            resources.map((resource) => resource.id),
            {
              identicalQuestionKeys: resources.map((resource) => {
                const facts = factsOf(resource);
                return identicalQuestionKey({
                  workspaceId,
                  resourceType: facts.resourceType,
                  rawName: facts.rawName,
                  rawCode: facts.rawCode,
                  rawUnit: facts.rawUnit,
                });
              }),
            },
          )
        : null;
    const stateOf = async (
      version: (typeof recipes)[number] | undefined,
    ): Promise<'COMPLETE' | 'AWAITING_IDENTITY' | 'NOT_USABLE'> => {
      if (!version || version.resources.length === 0 || !version.outputUnit) {
        return 'NOT_USABLE';
      }
      if (!(await unitProvedToday(version.outputUnit, null)))
        return 'NOT_USABLE';
      let identified = true;
      for (const resource of version.resources) {
        const group = (['LABOR', 'MATERIAL', 'EQUIPMENT'] as const).find(
          (candidate) => candidate === resource.resourceType,
        );
        if (
          !group ||
          !(Number(resource.coefficient) > 0) ||
          !(await unitProvedToday(resource.baseUnit, group))
        ) {
          return 'NOT_USABLE';
        }
        if (!evidence) continue;
        // Every component is asked, as the consumer asks every one.
        const verdict = await this.identity.resolve(
          {
            ...evidence,
            ghxSubject: {
              workspaceId,
              ahspResourceId: resource.id,
              resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
            },
          },
          factsOf(resource),
        );
        identified =
          identified &&
          verdict.status === 'RESOLVED' &&
          evidence.catalogCandidates.some(
            (candidate) => candidate.id === verdict.resolvedResourceCatalogId,
          );
      }
      return identified ? 'COMPLETE' : 'AWAITING_IDENTITY';
    };
    for (const line of lines) {
      states.set(
        line.id,
        await stateOf(
          line.ahspVersionId
            ? writtenById.get(line.ahspVersionId)
            : line.ahspId
              ? offeredByParent.get(line.ahspId)
              : undefined,
        ),
      );
    }
    return states;
  }

  /**
   * What the Unit Kernel says differently spelled statements of ONE output unit
   * are: one unit, different units, or not provable (a spelling it does not know).
   */
  private async outputUnitStatementsVerdict(
    statements: readonly AhspSourceLocator[],
    definitionOf: (raw: string) => Promise<string | null>,
  ): Promise<'SAME' | 'DIFFERENT' | 'UNPROVEN'> {
    const definitions: Array<string | null> = [];
    for (const statement of statements) {
      definitions.push(await definitionOf(statement.raw));
    }
    if (definitions.includes(null)) return 'UNPROVEN';
    return new Set(definitions).size === 1 ? 'SAME' : 'DIFFERENT';
  }

  /** The unit definition an output-unit spelling resolves to today, if exactly one. */
  private async outputUnitDefinition(raw: string): Promise<string | null> {
    const unit = await this.units.resolve(raw, raw);
    return unit.status === UNIT_RESOLUTION_STATUS.RESOLVED
      ? (unit.sourceUnitDefinition?.id ?? null)
      : null;
  }

  /**
   * The unit spellings a waiting line still waits for today, as the document
   * spells them and how often; or, when the Unit Kernel now knows every one, that
   * the line is worth checking again. Only what the import itself asks is asked:
   * the output unit (or each of its differently spelled statements), and each
   * named, classed component's unit.
   */
  private async unitsWaitedFor(
    knowledge: AhspWorkItemKnowledge,
    unitProvedToday: (
      raw: string,
      group: AhspResourceGroup | null,
    ) => Promise<boolean>,
  ): Promise<
    | { unitsKnownNow: true }
    | { unknownUnits: Array<{ spelling: string; uses: number }> }
  > {
    const unknown = new Map<string, number>();
    const ask = async (raw: string, group: AhspResourceGroup | null) => {
      if (await unitProvedToday(raw, group)) return;
      const spelling = raw.trim();
      unknown.set(spelling, (unknown.get(spelling) ?? 0) + 1);
    };
    if (knowledge.outputUnitRaw) {
      await ask(knowledge.outputUnitRaw.raw, null);
    } else {
      for (const statement of knowledge.outputUnitStatements ?? []) {
        await ask(statement.raw, null);
      }
    }
    for (const resource of knowledge.resources) {
      if (!resource.rawName || !resource.group || resource.rawUnit === null)
        continue;
      await ask(resource.rawUnit, resource.group);
    }
    return unknown.size === 0
      ? { unitsKnownNow: true }
      : {
          unknownUnits: [...unknown].map(([spelling, uses]) => ({
            spelling,
            uses,
          })),
        };
  }

  /**
   * THE unit question an import asks: an output unit must resolve to a unit
   * definition; a component's unit must resolve under its class's context.
   */
  private async unitProved(
    raw: string,
    group: AhspResourceGroup | null,
  ): Promise<boolean> {
    if (group === null) {
      const unit = await this.units.resolve(raw, raw);
      return (
        unit.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
        Boolean(unit.sourceUnitDefinition)
      );
    }
    const unit = await this.units.resolve(
      raw,
      raw,
      undefined,
      GROUP_TO_CONTEXT[group],
    );
    return unit.status === UNIT_RESOLUTION_STATUS.RESOLVED;
  }

  /**
   * ONE write path for a fresh commit and a continuation. `lines` are aligned
   * with `knowledge.workItems`, one durable intake line per item.
   *
   * Every item is its own unit: a canonical write is whole-or-nothing
   * (IMPORT-SEAM-08), and an item that cannot be written — or whose write fails —
   * never erases or blocks the items around it.
   */
  private async commitKnowledge(
    knowledge: AhspDocumentKnowledge,
    context: {
      workspaceId: string;
      userId: string;
      decisions: readonly AhspImportDecision[];
      importJobId: string;
      lines: readonly AhspImportJournalLine[];
    },
  ): Promise<AhspDocumentCommitResult> {
    const { workspaceId, userId, lines } = context;
    if (lines.length !== knowledge.workItems.length) {
      throw new ConflictException('AHSP_IMPORT_JOURNAL_MISALIGNED');
    }
    const decisionByItem = this.decisionMap(context.decisions);
    // IMPORT-SEAM-03 — SOURCE TRUTH FIRST. What the document said about a
    // resource SIMPROK could not prove is kept before anything canonical is
    // attempted: awaited and never swallowed, so if it cannot be kept no write
    // begins. It used to run after the writes, best-effort, and any earlier
    // failure skipped it for the whole document.
    await this.observeUnresolved(knowledge, workspaceId);

    const skipped: Array<AhspDocumentCommitResult['skipped'][number]> = [];
    const written: Array<AhspDocumentCommitResult['written'][number]> = [];
    const failed: Array<AhspDocumentCommitResult['failed'][number]> = [];
    const sightings: Prisma.ResourceSourceIdentityCreateManyInput[] = [];
    const counts = {
      ready: 0,
      identityPending: 0,
      alreadyPresent: 0,
      alreadyProcessed: 0,
      held: 0,
    };

    for (const [index, item] of knowledge.workItems.entries()) {
      const line = lines[index];
      const workType = item.workType?.raw ?? null;
      const methodName = item.methodName?.raw ?? null;
      const admission = item.admission ?? 'HELD';
      const verdict = item.identityVerdict ?? 'DISTINCT';
      const decision = decisionByItem.get(workType + '\u0000' + methodName);

      let outcome: AhspImportItemOutcome;
      try {
        // IMPORT-SEAM-09 — ONE LINE, ONE AUTHORITATIVE OUTCOME. Nothing is
        // decided about this item — nothing written, adopted or recorded — until
        // its intake line is LOCKED and re-read here: the status a request loaded
        // can be stale by the time it writes, and the same document uploaded
        // again must not act a second time on a line an earlier evaluation has
        // already settled.
        outcome = await this.prisma.$transaction(async (txc) => {
          const tx = txc as Prisma.TransactionClient;
          const current = await this.journal.lockLine(tx, {
            workspaceId,
            lineId: line.id,
          });
          if (!current) return { kind: 'UNREACHABLE' as const };
          // ALREADY REPRESENTED — the first lawful outcome stands. A replay, a
          // re-upload, or a different decision arriving afterwards reports what
          // is recorded; it never rewrites it and never acts again.
          if (current.status === ImportStatus.COMPLETED) {
            return this.alreadyProcessed(current);
          }
          return this.settleHeldItem(
            item,
            knowledge,
            { workspaceId, userId, lineId: line.id, decision },
            tx,
          );
        }, ITEM_TRANSACTION);
      } catch (error) {
        outcome = await this.settleAfterRollback(error, {
          workspaceId,
          lineId: line.id,
          reasonCodes: item.reasonCodes,
        });
      }

      switch (outcome.kind) {
        case 'WRITTEN':
          written.push({
            workType: workType as string,
            methodName: methodName as string,
            ahspId: outcome.ahspId,
            versionId: outcome.versionId,
            admission: admission as Exclude<AhspWorkItemAdmission, 'HELD'>,
            identityPendingResources: item.resources.filter(
              (resource) => resource.resolvedResourceCatalogId === null,
            ).length,
          });
          if (admission === 'PROVEN') counts.ready += 1;
          else counts.identityPending += 1;
          if (verdict === 'POSSIBLY_IDENTICAL') {
            // Record that a possible twin was SHOWN and deliberately kept separate.
            // Best-effort and OUTSIDE the item's transaction: the row already carries
            // a durable AHSPCreated entry, so losing this note corrupts nothing and
            // must never fail — or roll back — an otherwise-good write.
            await this.audit
              .logAction({
                ahspId: outcome.ahspId,
                action: 'AHSPImportKeptSeparate',
                who: userId,
                before: this.decisionProvenance(item, knowledge),
              })
              .catch(() => undefined);
          }
          sightings.push(...this.sightingsFor(item, knowledge, workspaceId));
          break;
        case 'ALREADY_PRESENT':
          skipped.push({
            workType,
            methodName,
            reasonCodes: outcome.reasonCodes,
          });
          counts.alreadyPresent += 1;
          break;
        case 'ALREADY_PROCESSED':
          skipped.push({
            workType,
            methodName,
            reasonCodes: outcome.reasonCodes,
          });
          counts.alreadyProcessed += 1;
          break;
        case 'HELD':
          skipped.push({
            workType,
            methodName,
            reasonCodes: outcome.reasonCodes,
          });
          counts.held += 1;
          break;
        // IMPORT-SEAM-08 — the item's transaction rolled back, so it wrote
        // nothing. The failure is kept on its intake line and returned — never
        // swallowed — and the items after it are still evaluated. A line this
        // workspace can no longer reach is the same truth for this request.
        case 'FAILED':
        case 'UNREACHABLE':
          failed.push({ workType, methodName, lineNumber: line.lineNumber });
          break;
      }
    }
    // Every PROVED reading in an accepted analysis enriches the shared sighting
    // memory (ResourceSourceIdentity), so a spelling proved once is recognised
    // the next time. Best-effort: learning must never fail an otherwise-good
    // commit.
    await this.rememberProvenReadings(sightings).catch(() => undefined);
    await this.journal.refreshJobStatus(workspaceId, context.importJobId);

    return {
      knowledge,
      importJobId: context.importJobId,
      summary: {
        evaluated: knowledge.workItems.length,
        ...counts,
        failed: failed.length,
      },
      written,
      skipped,
      failed,
    };
  }

  /**
   * What ONE still-open line lawfully becomes now — decided and settled on the
   * transaction that already HOLDS that line's lock, so every effect below
   * (adoption record, canonical write, settlement) commits or rolls back as one
   * act on a line that is still eligible for it.
   */
  private async settleHeldItem(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
    context: {
      workspaceId: string;
      userId: string;
      lineId: string;
      decision: AhspImportDecisionAction | undefined;
    },
    tx: Prisma.TransactionClient,
  ): Promise<AhspImportItemOutcome> {
    const { workspaceId, userId, lineId, decision } = context;
    const workType = item.workType?.raw ?? null;
    const methodName = item.methodName?.raw ?? null;
    const hold = async (
      reasonCodes: readonly AhspDocumentReasonCode[],
    ): Promise<AhspImportItemOutcome> => {
      await this.journal.settleOrThrow(tx, {
        workspaceId,
        lineId,
        status: ImportStatus.PENDING,
        reasonCodes,
      });
      return { kind: 'HELD', reasonCodes };
    };

    const admission = item.admission ?? 'HELD';
    if (admission === 'HELD' || workType === null || methodName === null) {
      return hold(
        item.reasonCodes.length
          ? item.reasonCodes
          : [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY],
      );
    }

    const verdict = item.identityVerdict ?? 'DISTINCT';

    // IDENTICAL — an AHSP with this exact identity already holds it (a
    // soft-deleted twin counts, because it still occupies the @@unique index).
    // NEVER create: that is both the ONE-TRUTH law and the fix for the raw
    // P2002/500. Nothing is auto-merged — the human adopts the existing AHSP or
    // leaves it, and the choice is recorded, never inferred.
    if (verdict === 'IDENTICAL') {
      const twin = item.identityMatches?.[0] ?? null;
      const reasonCodes = [AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY];
      // A live twin already represents this item. A soft-deleted one does not:
      // reviving it is a separate, governed act, so the item stays held.
      const representedBy = twin !== null && !twin.deleted ? twin.ahspId : null;
      if (decision === 'USE_EXISTING') {
        await this.recordUseExisting(item, knowledge, userId, tx);
      }
      await this.journal.settleOrThrow(tx, {
        workspaceId,
        lineId,
        status: representedBy ? ImportStatus.COMPLETED : ImportStatus.PENDING,
        reasonCodes,
        ahspId: representedBy,
      });
      return representedBy
        ? { kind: 'ALREADY_PRESENT', reasonCodes }
        : { kind: 'HELD', reasonCodes };
    }

    // POSSIBLY_IDENTICAL — a look-alike exists but identity is NOT proven. It
    // is never silently created: the human must explicitly keep it separate.
    // Absent that decision it is HELD (surfaced, not written, not lost) so the
    // human can still decide. Similarity is evidence, never an auto-action.
    if (verdict === 'POSSIBLY_IDENTICAL' && decision !== 'KEEP_SEPARATE') {
      const reasonCodes = [AHSP_DOCUMENT_REASON.IDENTITY_POSSIBLE_MATCH];
      if (decision !== 'USE_EXISTING') return hold(reasonCodes);
      const adoptedAhspId = await this.recordUseExisting(
        item,
        knowledge,
        userId,
        tx,
      );
      await this.journal.settleOrThrow(tx, {
        workspaceId,
        lineId,
        status: adoptedAhspId ? ImportStatus.COMPLETED : ImportStatus.PENDING,
        reasonCodes,
        ahspId: adoptedAhspId,
      });
      return adoptedAhspId
        ? { kind: 'ALREADY_PRESENT', reasonCodes }
        : { kind: 'HELD', reasonCodes };
    }

    // DISTINCT, or POSSIBLY with an explicit human KEEP_SEPARATE (its identity
    // differs from every existing one, so a distinct row is lawful).
    const saved = await this.writeItem(
      item,
      knowledge,
      { workspaceId, userId, lineId },
      tx,
    );
    return {
      kind: 'WRITTEN',
      ahspId: saved.ahspId,
      versionId: saved.versionId,
    };
  }

  /**
   * A line this evaluation found ALREADY REPRESENTED: its recorded reasons are
   * reported as they stand. They are the reasons of the evaluation that settled
   * it — this request states them, and claims nothing of its own.
   */
  private alreadyProcessed(line: AhspImportLockedLine): AhspImportItemOutcome {
    return {
      kind: 'ALREADY_PROCESSED',
      reasonCodes: line.reasonCodes as readonly AhspDocumentReasonCode[],
    };
  }

  /**
   * The item's transaction rolled back, so it wrote nothing. What is recorded
   * now is decided under the line's OWN lock, because another evaluation may
   * have completed it in the meantime: a completed line keeps its result and
   * this request reports it, and a still-open line is settled for what happened.
   */
  private async settleAfterRollback(
    error: unknown,
    context: {
      workspaceId: string;
      lineId: string;
      reasonCodes: readonly AhspDocumentReasonCode[];
    },
  ): Promise<AhspImportItemOutcome> {
    // The settlement itself refused: this line was represented while the write
    // was in flight. Nothing of this request committed — report the truth.
    if (error instanceof AhspImportLineAlreadySettledError) {
      return this.settleOpenLine(context.workspaceId, context.lineId, null, {
        kind: 'FAILED',
      });
    }
    // An identical AHSP appeared between classification and the write. Held
    // with that reason; the next evaluation classifies it for what it is.
    if (error instanceof ConflictException) {
      const reasonCodes = [AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY];
      return this.settleOpenLine(
        context.workspaceId,
        context.lineId,
        { status: ImportStatus.PENDING, reasonCodes },
        { kind: 'HELD', reasonCodes },
      );
    }
    return this.settleOpenLine(
      context.workspaceId,
      context.lineId,
      {
        status: ImportStatus.FAILED,
        reasonCodes: context.reasonCodes,
        errorMessage: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 500),
      },
      { kind: 'FAILED' },
    );
  }

  /**
   * Settle a line that is NOT being completed — held, or failed — under its own
   * lock. A line another evaluation has completed is never downgraded and never
   * reported as newly held or newly failed: its recorded result is what this
   * request returns. `outcome` null only re-reads.
   */
  private async settleOpenLine(
    workspaceId: string,
    lineId: string,
    outcome: AhspImportLineOutcome | null,
    settled: AhspImportItemOutcome,
  ): Promise<AhspImportItemOutcome> {
    return this.prisma.$transaction(async (txc) => {
      const tx = txc as Prisma.TransactionClient;
      const current = await this.journal.lockLine(tx, { workspaceId, lineId });
      if (!current) return { kind: 'UNREACHABLE' as const };
      if (current.status === ImportStatus.COMPLETED) {
        return this.alreadyProcessed(current);
      }
      if (outcome === null) return settled;
      await this.journal.settleOrThrow(tx, { workspaceId, lineId, ...outcome });
      return settled;
    }, ITEM_TRANSACTION);
  }

  /**
   * IMPORT-SEAM-08 — ONE WORK ITEM, WHOLE OR NOTHING. The parent AHSP, its
   * version, the version's resources, their durable audit entries and the intake
   * line that records them commit together, through the SAME writers every other
   * caller uses, on the transaction that holds this line's lock. A failure
   * anywhere leaves no parent without a version and no line claiming a write
   * that did not happen — and a settlement that changes no line rolls the whole
   * write back rather than leaving an AHSP the journal does not know about.
   */
  private async writeItem(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
    context: { workspaceId: string; userId: string; lineId: string },
    tx: Prisma.TransactionClient,
  ): Promise<{ ahspId: string; versionId: string }> {
    const { workspaceId, userId } = context;
    {
      // AhspService.create returns an untyped row; only the new parent's id is read.
      const parent = (await this.ahspService.create(
        {
          workspaceId,
          workType: item.workType!.raw,
          methodName: item.methodName!.raw,
          methodType: AHSP_PARENT_IDENTITY_FILLER.methodType,
          locationType: AHSP_PARENT_IDENTITY_FILLER.locationType,
          // ACG-01 CLOSURE 2 — the source's own item code, recorded as the code
          // it is. It already travels in `workType` because that is the column
          // AHSP identity is keyed on, but a reader asking "what is this item's
          // code?" had no column to read and no way to tell a code from a work
          // type. Additive and evidential: identity is untouched, and nothing
          // downstream treats this as a canonical key.
          //
          // Bidang / Divisi / Jenis Pekerjaan stay NULL here on purpose. The
          // parser contract carries no such fact, so supplying one would mean
          // inferring it from a document heading — context invented rather than
          // read. See the closure report for the exact narrow blocker.
          code: item.workType!.raw,
          userId,
        },
        tx,
      )) as { id: string };
      const version = await this.versionService.createVersion(
        parent.id,
        {
          workspaceId,
          userId,
          outputUnit: item.resolvedOutputUnit ?? item.outputUnitRaw!.raw,
          regulationReference:
            item.regulationReference?.raw ??
            knowledge.document.regulationReference?.raw,
          // CLOSURE 1 — what the document actually said about this line, kept
          // beside the identity the import proved.
          resources: item.resources.map((resource) => ({
            // IMPORT-SEAM-01 — the catalogue id the identity kernel PROVED, or,
            // while that identity is still pending, the source's own words: the
            // convention hand-built recipes use and the occurrence path reads by
            // shape. Never a candidate, a weak possibility or a ruled-out row.
            resourceId: resource.resolvedResourceCatalogId ?? resource.rawName!,
            resourceType: resource.group!,
            coefficient: resource.coefficient!,
            baseUnit: resource.resolvedBaseUnit ?? resource.rawUnit!,
          })),
        },
        tx,
        {
          // CLOSURE 1 — what the document actually said, handed in on the
          // TRUSTED road: one whole origin per line, from the reading this very
          // method performed. It travels beside the recipe rather than inside
          // it, so the same shape can never arrive from a request body.
          sourceFacts: item.resources.map((resource) => ({
            rawName: resource.rawName,
            rawCode: resource.rawCode,
            rawUnit: resource.rawUnit,
            sourceSha256: knowledge.source.contentDigestSha256,
            sourceFileName: knowledge.source.fileName,
            parserContractVersion: knowledge.source.readerContractVersion,
            sheetName: resource.nameEvidence?.sheetName ?? null,
            sourceRowNumber: resource.nameEvidence?.rowNumber ?? null,
            sourceNameCellAddress: resource.nameEvidence?.locator ?? null,
            sourceCodeCellAddress: resource.codeEvidence?.locator ?? null,
            sourceUnitCellAddress: resource.unitEvidence?.locator ?? null,
          })),
        },
      );
      await this.recordIdenticalQuestionReuse(
        item,
        knowledge,
        parent.id,
        version.id,
        userId,
        tx,
      );
      await this.journal.settleOrThrow(tx, {
        workspaceId,
        lineId: context.lineId,
        status: ImportStatus.COMPLETED,
        reasonCodes: item.reasonCodes,
        ahspId: parent.id,
        ahspVersionId: version.id,
      });
      return { ahspId: parent.id, versionId: version.id };
    }
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
   * DURABLE: awaited and uncaught, on the item's own transaction together with its
   * intake line. For a use-existing decision nothing is created, so this row is the
   * only trace that a human weighed a duplicate — if it cannot be written, neither
   * is the line, and the failure is recorded on that line and returned.
   *
   * Returns the AHSP the human's choice now represents the item by, or null when
   * the choice was refused (or there was nothing to choose).
   */
  private async recordUseExisting(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
    userId: string,
    client: Prisma.TransactionClient,
  ): Promise<string | null> {
    const matches = item.identityMatches ?? [];
    const primaryMatch = matches[0];
    if (!primaryMatch) return null;
    const honoured = matches.length === 1 && !primaryMatch.deleted;
    await this.audit.logAction(
      {
        ahspId: primaryMatch.ahspId,
        action: honoured
          ? 'AHSPImportUsedExisting'
          : 'AHSPImportUsedExistingRefused',
        who: userId,
        before: this.decisionProvenance(item, knowledge),
      },
      client,
    );
    return honoured ? primaryMatch.ahspId : null;
  }

  /**
   * IQL-01 — a committed analysis whose component identity came from an
   * APPROVED exact-question answer says so, through the one AHSP provenance
   * channel. The AHSP row stores only a catalog id, so without this entry a
   * later reader could not tell a human-verified reuse from a machine-proven
   * match. DURABLE, like recordUseExisting: it is the only trace — written on the
   * item's own transaction, so it exists exactly when the analysis does.
   */
  private async recordIdenticalQuestionReuse(
    item: AhspWorkItemKnowledge,
    knowledge: AhspDocumentKnowledge,
    ahspId: string,
    ahspVersionId: string,
    userId: string,
    client: Prisma.TransactionClient,
  ): Promise<void> {
    const reused = item.resources.filter(
      (resource) => resource.identicalQuestionDecisionId,
    );
    if (reused.length === 0) return;
    await this.audit.logAction(
      {
        ahspId,
        ahspVersionId,
        action: 'AHSPImportIdentityFromQuestionDecision',
        who: userId,
        after: {
          sourceFileName: knowledge.source.fileName,
          sourceSha256: knowledge.source.contentDigestSha256,
          resources: reused.map((resource) => ({
            rawName: resource.rawName,
            rawCode: resource.rawCode,
            rawUnit: resource.rawUnit,
            group: resource.group,
            resourceCatalogId: resource.resolvedResourceCatalogId,
            approvalDecisionId: resource.identicalQuestionDecisionId,
          })),
        },
      },
      client,
    );
  }

  /**
   * IQL-01 — the APPROVE event behind an identity the kernel settled as an
   * exact-question reuse, read from the evidence already loaded. Null for
   * every other authority.
   */
  private identicalQuestionApprovalId(
    authority: string | null,
    resource: AhspResourceKnowledge,
    evidence: ResourceIdentityEvidence,
  ): string | null {
    const scope = evidence.identicalQuestionScope;
    if (
      authority !== 'VERIFIED_IDENTICAL_QUESTION_REUSED' ||
      !scope ||
      !resource.rawName ||
      !resource.group
    ) {
      return null;
    }
    const key = identicalQuestionKey({
      workspaceId: scope.workspaceId,
      resourceType: resource.group,
      rawName: resource.rawName,
      rawCode: resource.rawCode,
      rawUnit: resource.rawUnit,
    });
    return evidence.identicalQuestionDecisions?.get(key)?.id ?? null;
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
   *
   * NEVER A READING SETTLED BY AN IQL-01 EXACT-QUESTION ANSWER. Sightings are
   * matched case- and whitespace-insensitively, so recording one would let an
   * answer approved for ONE exact wording nominate candidates for its variants
   * — and would outlive a REVOKE. Exact-question memory stays exact.
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
        resource.identicalQuestionDecisionId ||
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
    // IQL-01 — the exact questions this document asks, so an APPROVED
    // exact-question answer can be reused. One bounded preload; the same
    // wording, code, unit and class, byte for byte, or nothing.
    const identicalQuestionKeys = knowledge.workItems.flatMap((item) =>
      item.resources.flatMap((resource) =>
        resource.rawName && resource.group
          ? [
              identicalQuestionKey({
                workspaceId,
                resourceType: resource.group,
                rawName: resource.rawName,
                rawCode: resource.rawCode,
                rawUnit: resource.rawUnit,
              }),
            ]
          : [],
      ),
    );
    const loaded = await this.identity.loadEvidence(
      this.prisma,
      workspaceId,
      undefined,
      { identicalQuestionKeys },
    );
    // The AHSP-whole identity surface, loaded ONCE per document (mirroring the
    // resource-identity load-once step above), never per work item — the
    // workspace's AHSPs plus the Official Repository, indexed for the classifier.
    const identitySurface = await this.ahspService.loadIdentitySurface(workspaceId);
    /**
     * F1 — THE DECISIONS A PERSON ALREADY MADE ABOUT THIS DOCUMENT'S ROWS.
     *
     * Loaded ONCE per document, the same way the identity surface and the
     * evidence are, and asked only about the rows this document actually
     * contains. The observation lifecycle re-proves each one under today's law
     * before it answers, so nothing arrives here that today's law would refuse.
     */
    const decided = await this.observations.decidedIdentityForSourceRows(
      workspaceId,
      knowledge.workItems.flatMap((item) =>
        item.resources.flatMap((resource) =>
          resource.rawName && resource.group
            ? [
                {
                  sourceSha256: knowledge.source.contentDigestSha256 ?? null,
                  sheetName: resource.nameEvidence?.sheetName ?? null,
                  sourceRowNumber: resource.nameEvidence?.rowNumber ?? null,
                  rawName: resource.rawName,
                  resourceType: resource.group,
                  // The stated facts travel with the address: an answer about
                  // M144 at this row is not an answer about M999 at this row.
                  rawCode: resource.rawCode ?? null,
                  rawUnit: resource.rawUnit ?? null,
                  // The same value the observation was stored under
                  // (`observeUnresolved` writes the reader's contract version
                  // into `parserContractVersion`), so like is compared with like.
                  parserContractVersion:
                    knowledge.source.readerContractVersion ?? null,
                },
              ]
            : [],
        ),
      ),
    );
    const workItems: AhspWorkItemKnowledge[] = [];
    for (const item of knowledge.workItems) {
      const resolved = await this.resolveWorkItem(
        item,
        loaded,
        knowledge.source.contentDigestSha256 ?? null,
        decided,
      );
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
    return {
      ...item,
      ...this.identityOf(
        item.workType.raw,
        item.methodName.raw,
        surface,
        workspaceId,
      ),
    };
  }

  /** The one classifier call, for a document being read and a stored line alike. */
  private identityOf(
    workType: string,
    methodName: string,
    surface: readonly AhspIdentityRow[],
    workspaceId: string,
  ): Pick<AhspWorkItemKnowledge, 'identityVerdict' | 'identityMatches'> {
    const classification = classifyAhspIdentity(
      { workspaceId, workType, methodName },
      surface,
      {
        name: (raw) => this.norm.normalizeName(raw),
        code: (raw) => this.norm.normalizeCode(raw),
      },
    );
    if (classification.verdict === 'DISTINCT') {
      return { identityVerdict: 'DISTINCT', identityMatches: [] };
    }
    const matches =
      classification.verdict === 'IDENTICAL' && classification.exactMatch
        ? [classification.exactMatch]
        : classification.possibleMatches;
    return {
      identityVerdict: classification.verdict,
      identityMatches: matches,
    };
  }

  private async resolveWorkItem(
    item: AhspWorkItemKnowledge,
    evidence: ResourceIdentityEvidence,
    /** The digest of the document being read; carried down to each component. */
    sourceSha256: string | null,
    /** F1 — decisions already made about this document's rows, re-proved today. */
    decided: ReadonlyMap<string, string>,
  ): Promise<AhspWorkItemKnowledge> {
    let reasons: AhspDocumentReasonCode[] = [...item.reasonCodes];
    let outputUnitRaw = item.outputUnitRaw;
    // The document spelled its output unit differently in two places. Different
    // spellings are not yet different units — "m1" and "m'" may name one — and
    // only the Unit Kernel may say so. ONE unit: the statements agree after all,
    // and the first is used. DIFFERENT units: a contradiction in the source, held.
    // A spelling the kernel does not know: sameness is neither proved nor refuted,
    // so the item waits for that unit — it is never called a contradiction.
    const statements = item.outputUnitStatements ?? [];
    if (
      !outputUnitRaw &&
      statements.length > 1 &&
      reasons.includes(AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT)
    ) {
      const verdict = await this.outputUnitStatementsVerdict(
        statements,
        (raw) => this.outputUnitDefinition(raw),
      );
      if (verdict !== 'DIFFERENT') {
        reasons = reasons.filter(
          (code) => code !== AHSP_DOCUMENT_REASON.SOURCE_UNIT_CONFLICT,
        );
      }
      if (verdict === 'SAME') outputUnitRaw = statements[0];
      if (verdict === 'UNPROVEN') {
        reasons.push(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
      }
    }
    let resolvedOutputUnit: string | null = null;
    if (outputUnitRaw) {
      if (await this.unitProved(outputUnitRaw.raw, null)) {
        resolvedOutputUnit = outputUnitRaw.raw;
      } else {
        reasons.push(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
      }
    }
    const resources: AhspResourceKnowledge[] = [];
    for (const resource of item.resources) {
      resources.push(
        await this.resolveResource(resource, evidence, sourceSha256, decided),
      );
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
      outputUnitRaw,
      resolvedOutputUnit,
      resources,
      reasonCodes: unique,
      status: ready ? 'READY' : 'UNRESOLVED',
      admission: ready
        ? 'PROVEN'
        : this.isIdentityOnlyGap(item, resolvedOutputUnit, resources, unique)
          ? 'IDENTITY_PENDING'
          : 'HELD',
    };
  }

  /**
   * IMPORT-SEAM-01 — is the recipe WHOLE, with component identity the only open
   * question? Every fact a recipe needs must be proved: both names, the output
   * unit, and for every component its name, class, a positive coefficient and a
   * proved unit. The only reasons tolerated are "this component is not identified
   * yet" (found nothing, or found candidates it could not prove).
   *
   * Decided from reasons SIMPROK already derived, never re-scored. A missing,
   * invalid, unproved or contradictory fact — or a duplicate in the document, or
   * an ambiguous structure — keeps the item HELD. And the source's own wording must
   * not look like a catalogue id, because it is about to be stored in the column
   * whose meaning is read from exactly that shape.
   */
  private isIdentityOnlyGap(
    item: AhspWorkItemKnowledge,
    resolvedOutputUnit: string | null,
    resources: readonly AhspResourceKnowledge[],
    reasons: readonly AhspDocumentReasonCode[],
  ): boolean {
    return (
      item.workType !== null &&
      item.methodName !== null &&
      resolvedOutputUnit !== null &&
      resources.length > 0 &&
      reasons.every(
        (code) =>
          code === AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN ||
          IDENTITY_ONLY_REASONS.has(code),
      ) &&
      resources.every(
        (resource) =>
          resource.rawName !== null &&
          resource.group !== null &&
          resource.coefficient !== null &&
          resource.coefficient > 0 &&
          resource.rawUnit !== null &&
          resource.reasonCodes.every((code) =>
            IDENTITY_ONLY_REASONS.has(code),
          ) &&
          (resource.resolvedResourceCatalogId !== null ||
            !isResourceCatalogIdShape(resource.rawName)),
      )
    );
  }

  private async resolveResource(
    resource: AhspResourceKnowledge,
    evidence: ResourceIdentityEvidence,
    /**
     * The digest of the document being read, so the identity kernel can tell a
     * code THIS workbook already recorded for a catalogue row from a code some
     * other workbook happens to use. Null leaves every verdict as it was.
     */
    sourceSha256: string | null,
    /** F1 — decisions already made about this document's rows, re-proved today. */
    decided: ReadonlyMap<string, string>,
  ): Promise<AhspResourceKnowledge> {
    // A component the source never named cannot be searched for at all. That is
    // the ONLY thing that stops the investigation before it starts.
    if (!resource.rawName || !resource.group) {
      return resource;
    }

    const reasonCodes = [...resource.reasonCodes];
    const unitResolved =
      resource.rawUnit !== null &&
      (await this.unitProved(resource.rawUnit, resource.group));
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
      sourceSha256,
    });
    const identityCandidates = [
      ...new Set(
        (identity.candidates ?? [])
          .map((candidate) => candidate.name.trim())
          .filter((name) => name.length > 0),
      ),
    ];
    /**
     * F1 — A PERSON ALREADY ANSWERED THIS EXACT ROW.
     *
     * Consulted only where the machine did NOT settle it, so a machine proof is
     * never overridden, and only for the SAME source row — same document, sheet,
     * row, wording and class. The observation lifecycle has already re-proved
     * the decision under today's write-eligibility law, so a name-only answer
     * from the older law never reaches here.
     *
     * It settles IDENTITY alone. The unit is proved separately above and stays
     * exactly as it was; an unproven unit still holds the component back.
     */
    const decidedCatalogId =
      identity.status !== 'RESOLVED'
        ? decided.get(
            observedSourceRowKey({
              sourceSha256,
              sheetName: resource.nameEvidence?.sheetName ?? null,
              sourceRowNumber: resource.nameEvidence?.rowNumber ?? null,
              rawName: resource.rawName,
              resourceType: resource.group,
            }),
          )
        : undefined;
    if (decidedCatalogId) {
      return {
        ...resource,
        status: unitResolved ? 'READY' : 'UNRESOLVED',
        reasonCodes: unitResolved
          ? reasonCodes.filter(
              (code) => code !== AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
            )
          : reasonCodes,
        resolvedResourceCatalogId: decidedCatalogId,
        resolvedBaseUnit: unitResolved ? resource.rawUnit : null,
        identityCandidates,
      };
    }
    if (identity.status === 'RESOLVED' && identity.resolvedResourceCatalogId) {
      // Identity proved. The base unit is only carried when the Unit authority
      // proved it too — knowing WHICH resource this is never licenses asserting
      // what measure it is in.
      const approvalId = this.identicalQuestionApprovalId(
        identity.authority,
        resource,
        evidence,
      );
      return {
        ...resource,
        status: unitResolved ? resource.status : 'UNRESOLVED',
        reasonCodes,
        resolvedResourceCatalogId: identity.resolvedResourceCatalogId,
        resolvedBaseUnit: unitResolved ? resource.rawUnit : null,
        identityCandidates: [],
        // Present ONLY when an IQL-01 answer settled it, so every other
        // reading is byte-for-byte what it was.
        ...(approvalId ? { identicalQuestionDecisionId: approvalId } : {}),
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
        // ACG-01.1 — FOUND IS NOT OFFERED. A resolved verdict returned above, so
        // an UNRESOLVED verdict that still lists rows is listing what it RULED
        // OUT. Carried as a fact beside the names, so the reader is never told a
        // refused row is a possible match — and never that the source resource
        // itself was refused.
        ...(identity.status === 'UNRESOLVED'
          ? { identityCandidatesRuledOut: true as const }
          : {}),
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
