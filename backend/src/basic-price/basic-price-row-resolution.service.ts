import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RejectBasicPriceImportRowDto,
  ResolveBasicPriceImportRowDto,
} from './dto/resolve-basic-price-import-row.dto';
import { AdmitResourceForImportRowDto } from './dto/admit-resource-for-import-row.dto';
import {
  BasicPriceRowResolutionProposalService,
  type BasicPriceRowMachineProposal,
} from './basic-price-row-resolution-proposal.service';
import { toBasicPriceSafeCandidate } from './basic-price-row-resolution-proposal.service';
import { findProvenanceCandidate } from './basic-price-source-provenance.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { ResourceIdentityResolution } from '../resource-catalog/resource-identity-resolution.kernel';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  UNIT_KERNEL_POLICY_VERSION,
  UNIT_PRICE_OPERATION,
  UNIT_RESOLUTION_STATUS,
} from '../unit-kernel/unit-kernel.contracts';

/**
 * FNV-1a 32-bit, narrowed to a signed int4 because that is what
 * `pg_advisory_xact_lock(int4, int4)` accepts.
 *
 * Deterministic and dependency-free on purpose: the same workspace and resource
 * type must produce the same lock in every process and every replica, and a
 * hash collision only ever over-serializes two unrelated admissions, which is
 * safe.
 */
export function advisoryLockKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** Namespace half of the advisory lock — "this is a resource admission". */
export const RESOURCE_ADMISSION_LOCK_NAMESPACE = advisoryLockKey(
  'RM03D1_REVIEWED_RESOURCE_ADMISSION',
);

/**
 * How many machine-proven rows one transaction binds at a time.
 *
 * Small enough that no single transaction holds row locks across a whole
 * workbook (`assertBatchRowMutable` takes `FOR UPDATE` per row), large enough
 * that a normal batch finishes in a handful of round trips. A committed chunk
 * is permanent, so a later chunk failing costs only that chunk's work.
 */
const ACCEPT_MACHINE_PROVEN_CHUNK = 10;

/**
 * The most rows ONE request will bind, ever.
 *
 * Not a job platform, and deliberately not one: this is simply a refusal to
 * accept unbounded work in a single HTTP request. Anything past it comes back
 * as `remainingEligible`, and pressing again continues from persisted truth —
 * a row already bound is no longer `NEEDS_REVIEW`, so the second press does not
 * redo the first press's work.
 *
 * Comfortably above the Owner's 86-row workbook (13 eligible), so that journey
 * completes in exactly one command with `remainingEligible: 0`.
 */
const ACCEPT_MACHINE_PROVEN_MAX_PER_CALL = 500;

/**
 * WHY a mapping row exists, when it was not typed by a person.
 *
 * Recorded on every row bound by the governed batch acceptance so that mode is
 * distinguishable from an individual `Selesaikan` forever after. A blank reason
 * would make a batch acceptance look exactly like a reviewer who confirmed one
 * row and typed no note — and an audit trail that cannot say HOW a decision was
 * made only answers half the question.
 */
export const MACHINE_PROVEN_BATCH_ACCEPTANCE_REASON =
  'ACCEPTED_MACHINE_PROVEN_BATCH';

@Injectable()
export class BasicPriceRowResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceIdentity: ResourceIdentityResolutionService,
    private readonly unitKernel: UnitKernelService,
    // The ONE seam onto the canonical authorities. Injected so the resolve
    // path records the same machine verdict the review room displayed, rather
    // than a second matcher's opinion of it.
    private readonly proposals: BasicPriceRowResolutionProposalService,
  ) {}

  private async assertBatchRowMutable(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    batchId: string,
    rowId: string,
    currentAccountId: string,
  ) {
    const batchRows = await tx.$queryRaw<
      Array<{
        id: string;
        workspaceId: string;
        sourceSha256: string;
        selectedSheetName: string;
        parserContractVersion: string;
        uploadedByAccountId: string;
      }>
    >(
      Prisma.sql`SELECT "id", "workspaceId", "sourceSha256", "selectedSheetName", "parserContractVersion", "uploadedByAccountId" FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid`,
    );
    const batch = batchRows[0];
    if (!batch || batch.workspaceId !== workspaceId)
      throw new NotFoundException('Batch not found');
    assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');

    const rowLock = await tx.$queryRaw<
      Array<{
        id: string;
        batchId: string;
        version: number;
        status: string;
        proposedCanonicalPrice: Prisma.Decimal | null;
        resourceCatalogId: string | null;
        unitDefinitionId: string | null;
        // USI-01R — NULL when the source stated a resource category SIMPROK
        // could not safely map. The guard immediately after the row lock is
        // what keeps every consumer below able to treat this as a ResourceType.
        sourceSection: ResourceType | null;
        // BP-VISUAL-USABILITY-05 — UPLOADER_DECLARED is a weak batch hint, not
        // document truth. Resolve must be able to tell that apart from a
        // source-proven family before applying the type boundary.
        sourceSectionProvenance: string | null;
        sourceRowNumber: number;
        rawResourceCodeText: string | null;
        rawResourceNameText: string;
        rawUnitText: string | null;
      }>
    >(
      Prisma.sql`SELECT "id", "batchId", "version", "status", "proposedCanonicalPrice", "resourceCatalogId", "unitDefinitionId", "sourceSection", "sourceSectionProvenance", "sourceRowNumber", "rawResourceCodeText", "rawResourceNameText", "rawUnitText" FROM "basic_price_import_rows" WHERE "id" = ${rowId}::uuid FOR UPDATE`,
    );
    const row = rowLock[0];
    if (!row || row.batchId !== batchId)
      throw new NotFoundException('Row not found');

    // USI-01R LAW 2.9 — FAIL CLOSED ON AN UNKNOWN RESOURCE FAMILY.
    //
    // sourceSection is authority here: it binds the chosen ResourceCatalog's
    // type and scopes the Unit Kernel's context-sensitive alias lookup ("jam"
    // is a labour hour on a LABOR row and an equipment hour on an EQUIPMENT
    // one). A row whose family the source stated in words SIMPROK does not know
    // has no such context, and resolving it would mean picking that context by
    // default — exactly the guess intake already refused to make. So the row
    // waits for a human instead, and says why.
    if (row.sourceSection === null)
      throw new ConflictException('ROW_SOURCE_SECTION_UNRESOLVED');
    if (row.status !== 'NEEDS_REVIEW')
      throw new ConflictException('ROW_NOT_MUTABLE');
    // A BINDING, NOT A CAST. Control-flow narrowing on a property is lost the
    // moment the row is handed to another function, and every helper downstream
    // genuinely requires a known family. Returning the narrowed value means the
    // check above lives in exactly one place and every caller — ordinary
    // resolve and reviewed admission alike — inherits it.
    return { ...row, sourceSection: row.sourceSection, batch };
  }

  /**
   * Recompute the batch's aggregate state after a row transition (state
   * machine A: "NEEDS_REVIEW -> READY_FOR_REVIEW ... all rows resolved or
   * explicitly rejected"). Only NEEDS_REVIEW/READY_FOR_REVIEW batches are
   * touched — a batch already past submission is never reopened here.
   */
  private async recomputeBatchStatus(
    tx: Prisma.TransactionClient,
    batchId: string,
  ) {
    const [pendingCount, batch] = await Promise.all([
      tx.basicPriceImportRow.count({
        where: { batchId, status: 'NEEDS_REVIEW' },
      }),
      tx.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } }),
    ]);
    if (batch.status !== 'NEEDS_REVIEW' && batch.status !== 'READY_FOR_REVIEW')
      return;
    const nextStatus = pendingCount === 0 ? 'READY_FOR_REVIEW' : 'NEEDS_REVIEW';
    if (nextStatus !== batch.status) {
      await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: { status: nextStatus },
      });
    }
  }

  /**
   * Human resolution (state machine B: NEEDS_REVIEW -> READY_FOR_SUBMISSION,
   * BASIC_PRICE_RESOLVE). A row only reaches READY_FOR_SUBMISSION when it
   * has a canonical price AND no unresolved identity collision with
   * another row already resolved in the same batch — collision detection
   * is bounded to same-batch (resourceCatalogId, unitDefinitionId) pairs,
   * per schema contract §6's collision enum.
   *
   * RM-02D1: every resolve is also recorded as an append-only
   * BasicPriceImportRowResourceMapping decision — reviewer, timestamp,
   * reason (if given), and a server-computed (never client-trusted)
   * suggestionSource describing whether the chosen resourceCatalogId
   * matched a normalized-name candidate at decision time. This is written
   * regardless of whether the resolve attempt hits a collision — the human
   * decision to pick this identity happened either way, and the mapping
   * table is decision history, not row-current-state.
   */
  async resolveRow(
    workspaceId: string,
    batchId: string,
    rowId: string,
    reviewerAccountId: string,
    dto: ResolveBasicPriceImportRowDto,
  ) {
    return this.prisma.$transaction(
      (tx) =>
        this.resolveWithinTransaction(
          tx,
          workspaceId,
          batchId,
          rowId,
          reviewerAccountId,
          dto,
        ),
      // Same budget as `admitResourceForRow`. `resolveWithinTransaction` proves
      // identity, unit, and same-batch collision before it writes; Prisma's 5s
      // default is sized for a trivial update and turns a slow-but-lawful
      // resolve into P2028 instead of a finished mapping decision.
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  /**
   * ONE HUMAN ACTION OVER MANY DETERMINISTIC ROWS — and not one line of new
   * identity law.
   *
   * WHAT WAS WRONG. SIMPROK proved thirteen rows outright, then asked the
   * reviewer to press `Selesaikan` thirteen times to say so. That is not human
   * authority; it is transcription. Authority is the decision to accept what
   * was proven, and a person can make that decision once. Worse, the browser
   * was the thing looping — thirteen POSTs — so at a few thousand rows the
   * product simply stops working.
   *
   * THE CLIENT SENDS INTENT, NEVER DECISIONS. No ResourceCatalog id and no
   * UnitDefinition id crosses the wire. The caller says "accept what you can
   * prove in this batch, except these rows I am still thinking about", and the
   * SERVER re-derives the eligible set here, now, from the same authorities the
   * review room read. A client-authored list of bindings could be stale, or
   * manufactured, and would make the browser the identity authority.
   *
   * IT IS THE SAME AUTHORITY, ORCHESTRATED. Every row goes through
   * `resolveWithinTransaction` — the identical primitive `resolveRow` uses — so
   * the row lock, the ownership check, the ROW_NOT_MUTABLE guard, the unknown
   * family refusal, the Unit Kernel's trusted-context proof, collision
   * detection and the append-only reviewer mapping all happen exactly as they
   * do for a single click. There is no bulk resolver, and there must never be
   * one: a second path would drift from this one and the drift would be silent.
   *
   * THE REVIEWER IS STILL THE AUTHOR. `reviewerAccountId` is the acting human
   * on every mapping row written, identical to the single-row path. Nothing is
   * persisted before the person acts.
   *
   * BOUNDED, NOT HEROIC. Rows are bound in deterministic order in chunks, each
   * chunk its own transaction, in the same incremental spirit as
   * `keepBatchPrivate`: a chunk that commits stays committed, and re-running is
   * safe because a row already bound is no longer `NEEDS_REVIEW` and is simply
   * skipped. A row that refuses (a collision, a race, a human who resolved it
   * in another tab) is counted and stepped over — one stubborn row must not
   * discard the work of the rest.
   */
  async acceptMachineProvenRows(
    workspaceId: string,
    batchId: string,
    reviewerAccountId: string,
    options: { excludeRowIds?: readonly string[] } = {},
  ): Promise<{
    acceptedRowIds: string[];
    acceptedCount: number;
    eligibleCount: number;
    skippedCount: number;
    excludedCount: number;
    /**
     * Eligible rows this request did NOT reach because it hit its own work
     * ceiling. Zero for any ordinary batch; non-zero is an honest instruction
     * to press again, not a failure.
     */
    remainingEligible: number;
    /** How many times the identity authority's evidence was loaded. */
    evidenceLoads: number;
    chunks: number;
  }> {
    const excluded = new Set(options.excludeRowIds ?? []);

    // OWNERSHIP FIRST, before any proposal work is done on this batch's behalf.
    const batch = await this.prisma.basicPriceImportBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        uploadedByAccountId: true,
      },
    });
    if (!batch || batch.workspaceId !== workspaceId)
      throw new NotFoundException('Batch not found');
    assertBatchOwnedByCaller(batch, reviewerAccountId, 'Batch not found');
    if (batch.status !== 'NEEDS_REVIEW' && batch.status !== 'READY_FOR_REVIEW')
      throw new ConflictException('BATCH_NOT_MUTABLE');

    // Only rows still awaiting a decision are candidates. A rejected row, a row
    // already resolved, and a row a human is still editing in the browser are
    // all excluded here rather than being refused later.
    const rows = await this.prisma.basicPriceImportRow.findMany({
      where: { batchId, status: 'NEEDS_REVIEW' },
      orderBy: { sourceRowNumber: 'asc' },
      select: {
        id: true,
        // OPTIMISTIC VERSION, carried because the primitive demands it exactly
        // as it does from a single click: a row someone edited between this
        // read and the write fails ROW_VERSION_STALE and is skipped, which is
        // the correct answer rather than a silent overwrite.
        version: true,
        sourceSection: true,
        rawResourceNameText: true,
        rawResourceCodeText: true,
        rawUnitText: true,
      },
    });
    const considered = rows.filter((row) => !excluded.has(row.id));

    // THE SAME PROPOSAL AUTHORITY THE ROOM READ, asked again at execution time
    // so a stale screen cannot bind anything. Batched internally — one evidence
    // load for the whole set, never a query per row.
    const proposals = await this.proposals.proposeForRows(
      workspaceId,
      considered,
    );

    const eligible: Array<{
      rowId: string;
      version: number;
      resourceCatalogId: string;
      unitDefinitionId: string;
      proposal: BasicPriceRowMachineProposal;
    }> = [];
    for (const row of considered) {
      const proposal = proposals.get(row.id);
      if (!proposal) continue;
      // BOTH LEGS PROVEN AND THIS WORKSPACE MAY SELECT IT. `identityPairProven`
      // is the authorities' verdict; `admissibleForResolve` is Basic Price's
      // own actionability question. A candidate shortlist, a not-found name and
      // an unknown source family all fail here and stay open for a human.
      if (!proposal.identityPairProven) continue;
      if (!proposal.resource.admissibleForResolve) continue;
      const resourceCatalogId = proposal.resource.resourceCatalogId;
      const unitDefinitionId = proposal.unit.unitDefinitionId;
      if (!resourceCatalogId || !unitDefinitionId) continue;
      eligible.push({
        rowId: row.id,
        version: row.version,
        resourceCatalogId,
        unitDefinitionId,
        proposal,
      });
    }

    // THE REQUEST'S OWN WORK CEILING. Not a job platform — just a refusal to
    // accept an unbounded amount of work in one HTTP request. Anything beyond
    // it is reported as `remainingEligible` so the caller can press again, and
    // the second press continues from persisted truth rather than redoing
    // anything.
    const withinCeiling = eligible.slice(0, ACCEPT_MACHINE_PROVEN_MAX_PER_CALL);
    const remainingEligible = eligible.length - withinCeiling.length;

    const acceptedRowIds: string[] = [];
    let skippedCount = 0;
    let chunks = 0;
    for (
      let i = 0;
      i < withinCeiling.length;
      i += ACCEPT_MACHINE_PROVEN_CHUNK
    ) {
      const chunk = withinCeiling.slice(i, i + ACCEPT_MACHINE_PROVEN_CHUNK);
      chunks += 1;
      await this.prisma.$transaction(
        async (tx) => {
          for (const item of chunk) {
            try {
              await this.resolveWithinTransaction(
                tx,
                workspaceId,
                batchId,
                item.rowId,
                reviewerAccountId,
                {
                  version: item.version,
                  resourceCatalogId: item.resourceCatalogId,
                  unitDefinitionId: item.unitDefinitionId,
                  // HOW THIS DECISION WAS MADE, recorded on the append-only
                  // mapping so the two modes are distinguishable forever after.
                  // A blank reason would make a governed batch acceptance
                  // indistinguishable from a reviewer who confirmed one row and
                  // typed nothing — and "who decided" is only half the audit
                  // question; "how" is the other half.
                  reason: MACHINE_PROVEN_BATCH_ACCEPTANCE_REASON,
                },
                undefined,
                // The batch-wide verdict taken at the instant the human pressed.
                item.proposal,
              );
              acceptedRowIds.push(item.rowId);
            } catch (error) {
              // A ROW MAY LAWFULLY REFUSE. A same-identity collision with a row
              // bound moments ago, a stale version because someone edited it in
              // another tab, or a row already decided, are all real answers —
              // not failures of this action. Each is counted and stepped over.
              // Anything that is NOT a domain refusal still propagates, because
              // a broken database must not look like a skipped row.
              if (
                error instanceof ConflictException ||
                error instanceof BadRequestException ||
                error instanceof NotFoundException
              ) {
                skippedCount += 1;
                continue;
              }
              throw error;
            }
          }
        },
        // WIDENED DELIBERATELY, exactly as `admitResourceForRow` does. Prisma's
        // 5s default is sized for a single row, and a chunk is not a single row.
        { timeout: 30_000, maxWait: 30_000 },
      );
    }

    return {
      acceptedRowIds,
      acceptedCount: acceptedRowIds.length,
      eligibleCount: eligible.length,
      skippedCount,
      excludedCount: excluded.size,
      remainingEligible,
      // EXACTLY ONE, for the whole command, and it is counted rather than
      // asserted: the identity authority's evidence is loaded once above and
      // handed to every row, so this number does not grow with row count. If a
      // future edit reintroduces a per-row load, the acceptance test that reads
      // this field fails instead of the regression going unnoticed.
      evidenceLoads: 1,
      chunks,
    };
  }

  /**
   * TRUSTED UNIT CONTEXT PROOF — the one place Basic Price asks the Unit
   * Kernel whether the unit a human chose is actually the unit the source
   * document wrote.
   *
   * A UnitDefinition existing and being active proves only that the vocabulary
   * exists. It says nothing about the row in front of the reviewer, so without
   * this proof "Zak" could be stored as M3 and nothing in the system would ever
   * notice: the price would be per-zak while every later AHSP resolution reads
   * it as per-m3.
   *
   * THE CONTEXT IS THE ROW'S OWN sourceSection, NEVER THE RESOURCE NAME.
   * `row.sourceSection` is a governed classification the intake already carried
   * and the reviewer cannot retype — and RESOURCE_TYPE_MISMATCH above has
   * already bound the chosen ResourceCatalog to it. That is what makes it
   * trusted enough to disambiguate a context-scoped alias: "jam" resolves to
   * the labour hour on a LABOR row and to the equipment hour on an EQUIPMENT
   * row, and can never swap, because the context is not derived from text.
   *
   * A row whose source document carried no unit at all has nothing to prove
   * against — so the choice is refused for THAT ROW, never accepted on trust.
   * SIMPROK does not manufacture a fact it was never given.
   */
  private async assertSelectedUnitProvenBySourceUnit(
    row: { rawUnitText: string | null; sourceSection: ResourceType },
    unitDefinition: { code: string },
    resourceCatalogId?: string,
  ): Promise<void> {
    const rawSourceUnit = row.rawUnitText?.trim() ?? '';

    // NO SOURCE UNIT IS NOT A WEAKER PROOF — IT IS NO PROOF.
    //
    // Letting this case through was the one way a human-selected canonical unit
    // could still become a stored fact with nothing behind it. It is the most
    // dangerous case, not the mildest: an incompatible spelling at least fails
    // loudly, while an absent one would have been accepted in silence.
    //
    // Refused HERE rather than by asking the kernel to resolve '', so that
    // safety never depends on the catalogue happening to contain no empty
    // alias. The kernel is not consulted, and this body says so rather than
    // reporting a verdict nobody gave.
    //
    // `UNIT_REQUIRED` is the intake adapter's own existing code for exactly
    // this fact, already carried on the row the reviewer is looking at — the
    // precise cause, in vocabulary this architecture already speaks.
    //
    // This refuses ONE ROW's unproven fact. It is thrown inside that row's own
    // transaction, so the row simply stays NEEDS_REVIEW and every other row in
    // the batch remains resolvable: fail-closed on the fact, never on the
    // workflow.
    if (rawSourceUnit === '')
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution: {
          status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW,
          reasonCodes: ['UNIT_REQUIRED'],
          explanation:
            'Dokumen sumber tidak mencantumkan satuan pada baris ini, sehingga tidak ada bukti yang dapat membuktikan satuan pilihan manusia.',
          policyVersion: UNIT_KERNEL_POLICY_VERSION,
          // The original cell, unaltered — null stays null, blank stays blank.
          rawSourceUnit: row.rawUnitText,
          selectedUnitCode: unitDefinition.code,
          resourceContext: row.sourceSection,
          priceOperation: null,
        },
      });

    const proof = await this.unitKernel.resolve(
      rawSourceUnit,
      unitDefinition.code,
      resourceCatalogId,
      row.sourceSection,
    );
    // The same shape the reviewer already gets from the admission unit proof,
    // plus the two facts this seam exists to make visible: which context was
    // trusted, and what would have had to happen to the price.
    const unitResolution = {
      status: proof.status,
      reasonCodes: proof.reasonCodes,
      explanation: proof.explanation,
      policyVersion: proof.policyVersion,
      rawSourceUnit: proof.rawSourceUnit,
      selectedUnitCode: proof.rawTargetUnit,
      resourceContext: row.sourceSection,
      priceOperation: proof.priceOperation,
    };

    if (proof.status !== UNIT_RESOLUTION_STATUS.RESOLVED)
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'UNIT_SELECTION_INCOMPATIBLE_WITH_SOURCE',
        unitResolution,
      });

    // RESOLVED but not IDENTITY means the kernel found a real, evidence-bound
    // conversion — the quantity is convertible, and the PRICE would therefore
    // have to be divided by the same factor to stay true. Basic Price has no
    // such price-transformation seam today: `proposedCanonicalPrice` is the raw
    // source price per `rawUnitText`, and it is written into BasicPrice.value
    // untouched. Persisting the converted unit against an unconverted price
    // would publish a mathematically false price that reads as canonical.
    //
    // So SIMPROK refuses and says exactly why, rather than inventing the
    // missing arithmetic here. This is the fail-closed half of "SIMPROK
    // menghitung, manusia memutuskan": it will not quietly decide that a
    // per-sack price is a per-cubic-metre price.
    if (proof.priceOperation !== UNIT_PRICE_OPERATION.IDENTITY)
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'UNIT_SELECTION_REQUIRES_PRICE_CONVERSION',
        unitResolution,
      });
  }

  /**
   * The whole of a human resolution, minus the transaction boundary.
   *
   * Lifted out unchanged so REVIEWED RESOURCE ADMISSION can run it inside its
   * own atomic transaction. A row resolved against a just-admitted resource
   * must produce exactly the same transition and the same append-only mapping
   * decision as one resolved against an existing resource — copying this body
   * would let those two meanings drift apart, which is precisely what the
   * mapping table must never allow.
   */
  private async resolveWithinTransaction(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    batchId: string,
    rowId: string,
    reviewerAccountId: string,
    dto: ResolveBasicPriceImportRowDto,
    /**
     * Set only by REVIEWED RESOURCE ADMISSION: the catalog row this very
     * transaction created moments ago.
     *
     * The audit trail records what the human SAW when they decided, and this
     * identity did not exist then — they were shown nothing and supplied it
     * themselves. Counting it would make the record say "the reviewer picked
     * the single suggested candidate", where the candidate is the thing their
     * own decision brought into being. That is circular, and it would hide
     * every admission inside the ordinary resolve statistics.
     */
    justAdmittedResourceCatalogId?: string,
    /**
     * The machine's verdict for THIS row, already computed by the caller.
     *
     * Set only by the governed batch acceptance, and for two reasons. The
     * cheap one: without it, binding N rows re-runs the identity authority's
     * whole evidence load N times inside the transaction, once per row, to
     * write one audit field — the classic N+1, paid on the slowest path there
     * is. The important one: the audit field records WHAT THE MACHINE OFFERED
     * AT THE MOMENT THE HUMAN DECIDED, and in a batch acceptance the human
     * decided ONCE, before any row was bound. The batch-wide proposal taken at
     * that instant IS that moment; re-deriving it row by row would record a
     * picture that shifts as earlier rows are written.
     *
     * The single-row path passes nothing and is completely unchanged.
     */
    precomputedProposal?: BasicPriceRowMachineProposal | null,
  ) {
    {
      // reviewerAccountId is the caller's own account id (request.user.id) —
      // BASIC_PRICE_RESOLVE on the baseline means resolving mapping rows in
      // the caller's OWN uploaded batch, so it doubles as the ownership check.
      const row = await this.assertBatchRowMutable(
        tx,
        workspaceId,
        batchId,
        rowId,
        reviewerAccountId,
      );
      if (row.version !== dto.version)
        throw new ConflictException('ROW_VERSION_STALE');

      const resourceCatalog = await tx.resourceCatalog.findFirst({
        where: { id: dto.resourceCatalogId, workspaceId, status: 'ACTIVE' },
      });
      if (!resourceCatalog)
        throw new ConflictException('RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE');
      // RM-02D1-REMEDIATION-V3.2.1 (Blocker 2) + BP-VISUAL-USABILITY-05:
      // a DOCUMENT-PROVEN sourceSection (SOURCE_ROW_CATEGORY /
      // SOURCE_SECTION_TITLE) remains a hard type boundary. A weak batch
      // UPLOADER_DECLARED hint must NOT defeat a human-confirmed catalog
      // identity of a different family — that is how Batu Kali stamped
      // LABOR by a global "Upah" answer became un-saveable as Bahan.
      const typeMismatch = resourceCatalog.type !== row.sourceSection;
      const weakBatchHint =
        row.sourceSectionProvenance === 'UPLOADER_DECLARED';
      if (typeMismatch && !weakBatchHint)
        throw new ConflictException('RESOURCE_TYPE_MISMATCH');
      const effectiveSection: ResourceType = typeMismatch
        ? resourceCatalog.type
        : row.sourceSection;
      const unitDefinition = await tx.unitDefinition.findFirst({
        where: { id: dto.unitDefinitionId, isActive: true },
      });
      if (!unitDefinition)
        throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

      // The chosen unit must be provably the source document's own unit, in
      // this row's trusted resource context, before anything is written.
      //
      // REVIEWED RESOURCE ADMISSION reaches this same line inside its own
      // transaction, so admission cannot admit a resource under a unit an
      // ordinary resolve would have refused — one call site, one meaning, and
      // no second unit resolver anywhere in Basic Price. The catalog id is
      // passed because a resource-specific conversion rule is evidence the
      // kernel is entitled to see; on the admission path it is the identity
      // this transaction just created, which by construction has no rules yet.
      // When a weak batch hint is being corrected, Unit Kernel context follows
      // the catalog family the reviewer confirmed — never the stale hint.
      await this.assertSelectedUnitProvenBySourceUnit(
        { ...row, sourceSection: effectiveSection },
        unitDefinition,
        dto.resourceCatalogId,
      );

      const priorSameIdentity = await tx.basicPriceImportRow.findFirst({
        where: {
          batchId,
          id: { not: rowId },
          resourceCatalogId: dto.resourceCatalogId,
          unitDefinitionId: dto.unitDefinitionId,
          status: { in: ['READY_FOR_SUBMISSION', 'NEEDS_REVIEW'] },
        },
      });

      let collisionType:
        | 'NONE'
        | 'SAME_IDENTITY_SAME_VALUE'
        | 'SAME_IDENTITY_DIFFERENT_VALUE' = 'NONE';
      let collisionOfRowId: string | null = null;
      if (priorSameIdentity) {
        collisionOfRowId = priorSameIdentity.id;
        collisionType =
          priorSameIdentity.proposedCanonicalPrice?.toString() ===
          row.proposedCanonicalPrice?.toString()
            ? 'SAME_IDENTITY_SAME_VALUE'
            : 'SAME_IDENTITY_DIFFERENT_VALUE';
      }

      const canSubmit =
        collisionType === 'NONE' && row.proposedCanonicalPrice !== null;
      const updated = await tx.basicPriceImportRow.update({
        where: { id: rowId },
        data: {
          resourceCatalogId: dto.resourceCatalogId,
          resolvedResourceType: resourceCatalog.type,
          // Correct a weak batch hint to the family the human confirmed.
          // Document-proven families never reach here with a type mismatch.
          ...(typeMismatch ? { sourceSection: effectiveSection } : {}),
          unitDefinitionId: dto.unitDefinitionId,
          collisionType,
          collisionOfRowId,
          resolutionStatus: canSubmit
            ? 'RESOLVED'
            : collisionType !== 'NONE'
              ? 'RESOURCE_AMBIGUOUS'
              : 'UNRESOLVED',
          status: canSubmit ? 'READY_FOR_SUBMISSION' : 'NEEDS_REVIEW',
          resolvedByAccountId: reviewerAccountId,
          resolvedAt: new Date(),
          version: { increment: 1 },
        },
      });

      // RM-02D1-REMEDIATION-V3.2.1 (Blocker 1) — exact decision table:
      //   if hasConflict:                                    PROVENANCE_NAME_CONFLICT
      //   else if selectedId == provenanceCandidateId:        SOURCE_ROW_PROVENANCE
      //   else if selectedId matches exactly one name cand.:  NORMALIZED_NAME_SINGLE_CANDIDATE
      //   else if selectedId matches one of several name cand.: NORMALIZED_NAME_MULTIPLE_CANDIDATES
      //   else:                                                MANUAL_SEARCH
      // Critically, a provenance candidate merely EXISTING is never enough
      // for SOURCE_ROW_PROVENANCE — the reviewer's own dto.resourceCatalogId
      // must equal it. Provenance existing but the reviewer choosing a
      // different, same-typed resource is MANUAL_SEARCH, not
      // SOURCE_ROW_PROVENANCE; an audit trail that claimed otherwise would
      // misrepresent what the human actually did. hasConflict itself is
      // independent of the reviewer's choice — it fires whenever provenance
      // and normalized-name matching disagree, regardless of which side (or
      // neither) dto.resourceCatalogId matches, so the audit trail can find
      // every row where the two signals disagreed, not just the ones where
      // provenance "won".
      // THE AUDIT RECORDS WHAT THE REVIEWER WAS ACTUALLY SHOWN.
      //
      // These two fields — `suggestionSource` and `candidateCountAtDecision` —
      // are the permanent record of what the machine offered at the moment a
      // human decided. They used to be computed from `findMappingCandidates`,
      // a second matcher that tests ONE thing: exact equality of normalized
      // names, workspace-strict, ACTIVE only. The reviewer's screen came from
      // somewhere else entirely — the canonical Resource Identity authority,
      // which also consults aliases, source sightings, prior human decisions,
      // globally-scoped catalog rows and token/stem containment.
      //
      // The two disagree constantly on real data. On the Owner's Ambon workbook
      // 481 of 866 item rows begin with an OCR bullet ("-   Pasir Beton"), so
      // the normalized name never equals the catalog's ("Pasir beton") and the
      // old matcher returned ZERO for every one of them. A reviewer would be
      // shown a candidate by the canonical authority, click it, and the
      // permanent record would say `MANUAL_SEARCH, candidateCountAtDecision: 0`
      // — an audit trail describing a screen nobody saw.
      //
      // So the signal set now comes from the SAME authority the reviewer read.
      // It is passed `tx` because a resource admitted moments earlier in this
      // very transaction must be visible to it.
      //
      // THE ENUM VALUES ARE UNCHANGED, and their names are now historical:
      // `NORMALIZED_NAME_SINGLE_CANDIDATE` means "the authority offered exactly
      // one", not "one normalized name matched". Renaming them is a migration,
      // and a truthful signal under an old label is strictly better than a
      // false signal under an accurate one.
      const [machineProposal, provenance] = await Promise.all([
        // ONE EVIDENCE LOAD PER DECISION, not per row. A caller that already
        // asked the authority about this exact row — the governed batch
        // acceptance does, once for the whole batch — hands its answer in, and
        // the authority is not asked again.
        precomputedProposal !== undefined
          ? Promise.resolve(precomputedProposal)
          : this.proposals
              .proposeForRows(
                workspaceId,
                [
                  {
                    id: rowId,
                    sourceSection: row.sourceSection,
                    rawResourceNameText: row.rawResourceNameText,
                    rawResourceCodeText: row.rawResourceCodeText,
                    rawUnitText: row.rawUnitText,
                  },
                ],
                tx,
              )
              .then((byRow) => byRow.get(rowId) ?? null),
        findProvenanceCandidate(tx, {
          workspaceId,
          batchSourceSha256: row.batch.sourceSha256,
          sheetName: row.batch.selectedSheetName,
          parserContractVersion: row.batch.parserContractVersion,
          sourceRowNumber: row.sourceRowNumber,
          sourceSection: row.sourceSection,
          rawResourceCodeText: row.rawResourceCodeText,
          rawResourceNameText: row.rawResourceNameText,
          rawUnitText: row.rawUnitText,
        }),
      ]);

      // EVERY IDENTITY THE AUTHORITY PUT IN FRONT OF THE REVIEWER — a resolved
      // one counts as an offer just as a nominated candidate does.
      //
      // DISTINCT BY CATALOG ROW, because the two channels overlap: the
      // authority may RESOLVE to a row and also list that same row among its
      // candidates, and counting it twice would report one unambiguous offer as
      // NORMALIZED_NAME_MULTIPLE_CANDIDATES. What this set means is "how many
      // different identities was the human choosing between", so the same
      // identity named twice is one choice.
      const offeredIds = new Set<string>();
      if (machineProposal?.resource.resourceCatalogId) {
        offeredIds.add(machineProposal.resource.resourceCatalogId);
      }
      for (const candidate of machineProposal?.resource.candidates ?? []) {
        offeredIds.add(candidate.resourceCatalogId);
      }
      const allCandidates = [...offeredIds].map((resourceCatalogId) => ({
        resourceCatalogId,
      }));

      // The signal set as it stood at DECISION TIME. On the ordinary resolve
      // path nothing is excluded and this is simply `allCandidates`; on the
      // admission path the row just admitted is removed, because a resource
      // SIMPROK created seconds ago was never something the reviewer chose
      // between.
      const candidates = allCandidates.filter(
        (candidate) =>
          candidate.resourceCatalogId !== justAdmittedResourceCatalogId,
      );

      const provenanceCandidateId =
        provenance.candidate?.resourceCatalogId ?? null;
      // A conflict requires normalized-name matching to have independently
      // found something to disagree with — zero name candidates is not a
      // conflict, it is simply an unconfirmed (but still authoritative)
      // provenance signal.
      const hasConflict =
        provenanceCandidateId !== null &&
        candidates.length > 0 &&
        !candidates.some((c) => c.resourceCatalogId === provenanceCandidateId);

      let suggestionSource:
        | 'SOURCE_ROW_PROVENANCE'
        | 'PROVENANCE_NAME_CONFLICT'
        | 'NORMALIZED_NAME_SINGLE_CANDIDATE'
        | 'NORMALIZED_NAME_MULTIPLE_CANDIDATES'
        | 'MANUAL_SEARCH';
      if (hasConflict) {
        suggestionSource = 'PROVENANCE_NAME_CONFLICT';
      } else if (dto.resourceCatalogId === provenanceCandidateId) {
        suggestionSource = 'SOURCE_ROW_PROVENANCE';
      } else if (
        candidates.length === 1 &&
        candidates[0].resourceCatalogId === dto.resourceCatalogId
      ) {
        suggestionSource = 'NORMALIZED_NAME_SINGLE_CANDIDATE';
      } else if (
        candidates.length > 1 &&
        candidates.some((c) => c.resourceCatalogId === dto.resourceCatalogId)
      ) {
        suggestionSource = 'NORMALIZED_NAME_MULTIPLE_CANDIDATES';
      } else {
        suggestionSource = 'MANUAL_SEARCH';
      }

      // "How many distinct identities did the reviewer actually see as
      // signals" — dedups provenance against an agreeing name candidate,
      // and counts both sides separately when they conflict.
      const distinctSignalIds = new Set(
        candidates.map((c) => c.resourceCatalogId),
      );
      if (provenanceCandidateId !== null)
        distinctSignalIds.add(provenanceCandidateId);

      await tx.basicPriceImportRowResourceMapping.create({
        data: {
          workspaceId,
          rowId,
          resourceCatalogId: dto.resourceCatalogId,
          unitDefinitionId: dto.unitDefinitionId,
          reviewerAccountId,
          reason: dto.reason ?? null,
          suggestionSource,
          candidateCountAtDecision: distinctSignalIds.size,
        },
      });

      await this.recomputeBatchStatus(tx, batchId);
      return updated;
    }
  }

  /**
   * The ONE condition under which SIMPROK may bring a new canonical resource
   * into existence, and it is not this file's opinion — it is the verdict of
   * ResourceIdentityResolutionService, the same authority the Golden Thread
   * uses.
   *
   * All five must hold together. Anything less means the authority still had
   * something defensible to say: a resolved identity, a candidate worth a
   * human's glance, a type or specification contradiction. "Nothing was found
   * by a lookup I happened to run" is not the same fact as "the authority
   * exhausted every defensible avenue", and only the second one authorizes a
   * create.
   */
  private static isIdentityExhausted(
    identity: ResourceIdentityResolution,
  ): boolean {
    return (
      identity.status === 'UNRESOLVED' &&
      identity.reasonCodes.includes('RESOURCE_NOT_FOUND') &&
      identity.candidates.length === 0 &&
      identity.resolvedResourceCatalogId === null &&
      identity.authority === null
    );
  }

  /**
   * Hand the authoritative refusal back as a SAFE PROJECTION of the verdict.
   *
   * WHY IT IS NOT HANDED BACK WHOLE. The reviewer asked "does SIMPROK know
   * this?" and deserves the answer — which candidates exist, why each was
   * nominated, whether a human already settled one. That intent is unchanged.
   * What changed is that this used to answer by copying
   * `ResourceIdentityResolution` verbatim, and the canonical candidate carries
   * two things a browser must never receive:
   *
   *   priorHumanDecision   the reviewer's ACCOUNT ID, the moment they decided,
   *                        and their free-text private note;
   *   specifications       the catalog row's raw claims blob, surfaced for the
   *                        kernel's own reasoning rather than for a response.
   *
   * A batch is user-owned. Account B admitting a resource on B's own row must
   * not read the private note account A typed while settling A's row, even
   * though both work in one workspace and SIMPROK may lawfully KNOW about A's
   * decision. `identity.explanation` went the same way: it is written for an
   * auditor and names catalog ids, model vocabulary and, on the governed path,
   * that same account and note. No client reads it — the machine-readable
   * `message` is what callers switch on — so it is not sent.
   *
   * NOTHING WAS FORGOTTEN TO ACHIEVE THIS. The authority still loads the
   * mapping, still lets it nominate candidates, and still holds the full
   * decision internally; `isIdentityExhausted` above still reads the unprojected
   * verdict, so the ADMISSION GATE is decided on the whole truth and only the
   * REPLY is narrowed. Privacy belongs in the projection, never in the memory.
   */
  private static identityRefusal(
    identity: ResourceIdentityResolution,
  ): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'RESOURCE_IDENTITY_NOT_EXHAUSTED',
      resourceIdentity: {
        status: identity.status,
        authority: identity.authority,
        resolvedResourceCatalogId: identity.resolvedResourceCatalogId,
        reasonCodes: identity.reasonCodes,
        // The ONE shared Basic Price projection — the same function the review
        // room's `machineProposal` uses, so both outward seams narrow
        // identically and a future field cannot leak through only one of them.
        candidates: identity.candidates.map(toBasicPriceSafeCandidate),
      },
    });
  }

  /**
   * Ask the authority what it knows about THIS source row.
   *
   * Every fact in the reference comes from the row itself — the name, the
   * source code (or its absence), the unit as written, and the section the
   * workbook declared. Nothing a client sent can steer it.
   */
  private async resolveRowIdentity(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    row: {
      rawResourceNameText: string;
      rawResourceCodeText: string | null;
      rawUnitText: string | null;
      sourceSection: ResourceType;
    },
  ): Promise<ResourceIdentityResolution> {
    const evidence = await this.resourceIdentity.loadEvidence(tx, workspaceId);
    // RM-03D2: the same open transaction, so any canonical-unit evidence a
    // representation tie needs is read under the serialization this admission
    // already holds.
    return this.resourceIdentity.resolve(
      evidence,
      {
        rawName: row.rawResourceNameText,
        rawCode: row.rawResourceCodeText,
        rawUnit: row.rawUnitText,
        resourceType: row.sourceSection,
      },
      tx,
    );
  }

  /**
   * RM-03D1 — REVIEWED RESOURCE ADMISSION.
   *
   * SIMPROK must not be permanently blind to a resource its own source
   * documents contain. But admission does not get to decide what SIMPROK does
   * not know — RESOURCE IDENTITY does. This method only acts after that
   * authority has exhausted every defensible avenue it has: exact canonical
   * identity, source codes, provenance sightings, prior human decisions,
   * token containment and shared stems, across both this workspace's catalog
   * and the genuinely global one.
   *
   * So a differently-spelled resource does NOT become a second canonical row.
   * "Portland Cement" against a catalog holding "Semen Portlan" comes back
   * NEEDS_REVIEW with a named candidate, and this refuses — the reviewer
   * resolves against the candidate instead. Exact string equality is nowhere
   * in this path.
   *
   * Admission needs all of these true at once:
   *
   *   - a real imported source row exists and is still mutable;
   *   - the batch belongs to this workspace and this caller;
   *   - the resource TYPE comes from the row's own source section, never a
   *     client claim;
   *   - the reviewer names an EXISTING UnitDefinition, and the UnitKernel can
   *     actually represent its canonical code;
   *   - the authoritative identity resolution is exhausted (see
   *     `isIdentityExhausted`), re-proved under a serialization lock;
   *   - an authenticated reviewer explicitly asks, and says why.
   *
   * Everything lands in ONE transaction: catalog, provenance, and the row's
   * own resolution — so a half-admitted resource with no evidence behind it is
   * unrepresentable rather than merely unlikely.
   */
  async admitResourceForRow(
    workspaceId: string,
    batchId: string,
    rowId: string,
    reviewerAccountId: string,
    dto: AdmitResourceForImportRowDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.assertBatchRowMutable(
          tx,
          workspaceId,
          batchId,
          rowId,
          reviewerAccountId,
        );
        if (row.version !== dto.version)
          throw new ConflictException('ROW_VERSION_STALE');

        // Admission never mints unit vocabulary — the reviewer picks one that
        // already exists.
        const unitDefinition = await tx.unitDefinition.findFirst({
          where: { id: dto.unitDefinitionId, isActive: true },
        });
        if (!unitDefinition)
          throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

        // UNIT AUTHORITY PROOF. A UnitDefinition row existing is not the same
        // fact as the UnitKernel being able to resolve its code: a definition
        // with no active alias is vocabulary the kernel cannot see. Admitting a
        // resource whose baseUnit the unit authority cannot represent would bake
        // an unprovable string into the canonical catalog, and every later price
        // resolution against it would fail with no way back. The kernel is asked
        // here, exactly as it is everywhere else — no new alias, no new rule, no
        // normalization of our own.
        const unitProof = await this.unitKernel.resolve(
          unitDefinition.code,
          unitDefinition.code,
        );
        if (unitProof.status !== UNIT_RESOLUTION_STATUS.RESOLVED) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY',
            unitResolution: {
              status: unitProof.status,
              reasonCodes: unitProof.reasonCodes,
              explanation: unitProof.explanation,
            },
          });
        }

        // …and the SAME row-level proof an ordinary resolve applies, asked here
        // rather than only in the shared body below, so an unprovable unit is
        // refused BEFORE this request waits on the admission lock and before a
        // ResourceCatalog is created for it. A rollback would erase the row
        // either way; refusing first means SIMPROK never took the step at all.
        //
        // No catalog id: the identity does not exist yet, so there is no
        // resource-specific conversion evidence the kernel could lawfully see.
        // The shared body asks again with the created id — same helper, same
        // law, and by construction the new identity carries no rules that could
        // change the answer.
        await this.assertSelectedUnitProvenBySourceUnit(row, unitDefinition);

        // First authoritative pass — cheap refusal before anyone waits on a
        // lock. It never authorizes anything on its own.
        const preLockIdentity = await this.resolveRowIdentity(
          tx,
          workspaceId,
          row,
        );
        if (
          !BasicPriceRowResolutionService.isIdentityExhausted(preLockIdentity)
        )
          throw BasicPriceRowResolutionService.identityRefusal(preLockIdentity);

        // SERIALIZATION. The row lock above protects one row, which is not
        // enough: two DIFFERENT rows — or two different batches — can each ask
        // for a genuinely-new resource, both read "not found" before either
        // commits, and both create one.
        //
        // THE DOMAIN IS (workspace, resource type) AND DELIBERATELY NOT THE
        // RESOURCE NAME. Keying on the name looks tighter and is wrong, because
        // it assumes what this whole slice exists to deny: that two spellings
        // are two resources. "Semen Portland" and "Semen Portlan" would hash to
        // two different locks, run in parallel, and each re-prove against a
        // catalog that did not yet contain the other — so both would be
        // admitted, and the identity authority would afterwards nominate each
        // as a candidate for the other. RESOURCE NAME != RESOURCE IDENTITY has
        // to hold in the serialization boundary too, and the only boundary that
        // can honour it without a second matcher is one wider than any name.
        //
        // Deriving a cleverer key from stems, codes or similarity would be
        // exactly the duplicate intelligence law this must not grow. Admission
        // is a rare human exception path, so a workspace-and-type domain costs
        // nothing real and fails safe.
        //
        // Transaction-scoped: deterministic, held only for this transaction,
        // released automatically on commit or rollback, and needing no schema,
        // no application mutex and no external infrastructure.
        const lockKey = advisoryLockKey(`${workspaceId}|${row.sourceSection}`);
        // $executeRaw, not $queryRaw: the function returns SQL `void`, which
        // has no Prisma type to deserialize into.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${RESOURCE_ADMISSION_LOCK_NAMESPACE}::int4, ${lockKey}::int4)`,
        );

        // SECOND authoritative pass, and the only one that may authorize a
        // create. Evidence is re-loaded from scratch inside this transaction
        // after the lock, so if a concurrent request admitted this resource
        // while we waited, we now see it as a real candidate and refuse —
        // handing the caller the identity that already exists instead of a
        // duplicate.
        const identity = await this.resolveRowIdentity(tx, workspaceId, row);
        if (!BasicPriceRowResolutionService.isIdentityExhausted(identity))
          throw BasicPriceRowResolutionService.identityRefusal(identity);

        // Full provenance needs two facts the mutability check does not carry:
        // the row's own cell addresses, and the batch's file name.
        const evidence = await tx.basicPriceImportRow.findUniqueOrThrow({
          where: { id: rowId },
          select: {
            sourceCodeCellAddress: true,
            sourceNameCellAddress: true,
            sourceUnitCellAddress: true,
            batch: { select: { sourceFileName: true } },
          },
        });

        const catalog = await tx.resourceCatalog.create({
          data: {
            workspaceId,
            // Exactly what the source says. Not normalized, not tidied.
            name: row.rawResourceNameText,
            // The source's own section decides the class, so a LABOR row can
            // never admit a MATERIAL, whatever anyone asks for.
            type: row.sourceSection,
            baseUnit: unitDefinition.code,
            // Only if the source genuinely supplies one. No code is invented,
            // and none is borrowed from a lookalike.
            code: row.rawResourceCodeText ?? null,
            // No specification is asserted: the source stated none.
          },
        });

        try {
          await tx.resourceSourceIdentity.create({
            data: {
              resourceCatalogId: catalog.id,
              workspaceId,
              sourceSha256: row.batch.sourceSha256,
              sourceFileName: evidence.batch.sourceFileName,
              parserContractVersion: row.batch.parserContractVersion,
              sheetName: row.batch.selectedSheetName,
              sourceRowNumber: row.sourceRowNumber,
              sourceSection: row.sourceSection,
              sourceCodeCellAddress: evidence.sourceCodeCellAddress,
              sourceNameCellAddress: evidence.sourceNameCellAddress,
              sourceUnitCellAddress: evidence.sourceUnitCellAddress,
              rawCode: row.rawResourceCodeText,
              rawName: row.rawResourceNameText,
              rawUnit: row.rawUnitText,
            },
          });
        } catch (error) {
          // This exact source row is already bound to some other catalog entry
          // (the provenance model is unique per workspace/file/sheet/row/parser).
          // The identity authority did not surface it — an inactive resource is
          // not a candidate — but admission must not quietly steal the binding.
          // Rethrowing aborts the whole transaction, so the catalog row created
          // moments ago never exists.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
            throw new ConflictException('RESOURCE_PROVENANCE_ALREADY_BOUND');
          throw error;
        }

        // Same path a chosen resource takes, so the mapping decision reads the
        // same way. Excluding the row we just created leaves zero candidates and
        // no provenance signal, so it records MANUAL_SEARCH at
        // candidateCountAtDecision 0 — the honest description: nothing suggested
        // this identity, a human supplied it.
        const resolved = await this.resolveWithinTransaction(
          tx,
          workspaceId,
          batchId,
          rowId,
          reviewerAccountId,
          {
            version: dto.version,
            resourceCatalogId: catalog.id,
            unitDefinitionId: dto.unitDefinitionId,
            reason: dto.reason,
          },
          catalog.id,
        );

        return { admittedResource: catalog, row: resolved };
      },
      // The serialization lock is deliberate, so waiting on it is a correct
      // outcome and must not be mistaken for a stuck transaction. A loser in a
      // genuine race waits for the winner's whole admission to commit; the
      // default 5s budget would turn that into a spurious timeout instead of
      // the truthful "SIMPROK already knows this now" answer.
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  /** Human rejection (state machine B, reason required, no automatic path). */
  async rejectRow(
    workspaceId: string,
    batchId: string,
    rowId: string,
    currentAccountId: string,
    dto: RejectBasicPriceImportRowDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.assertBatchRowMutable(
          tx,
          workspaceId,
          batchId,
          rowId,
          currentAccountId,
        );
        if (row.version !== dto.version)
          throw new ConflictException('ROW_VERSION_STALE');

        const updated = await tx.basicPriceImportRow.update({
          where: { id: rowId },
          data: {
            status: 'REJECTED',
            reasonCodes: { push: `REJECTED:${dto.reason}` },
            resolvedAt: new Date(),
            version: { increment: 1 },
          },
        });

        await this.recomputeBatchStatus(tx, batchId);
        return updated;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  }
}
