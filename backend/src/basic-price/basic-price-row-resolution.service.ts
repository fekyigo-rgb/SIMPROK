import {
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
import { findMappingCandidates } from './basic-price-row-mapping-candidates.service';
import { findProvenanceCandidate } from './basic-price-source-provenance.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { ResourceIdentityResolution } from '../resource-catalog/resource-identity-resolution.kernel';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { UNIT_RESOLUTION_STATUS } from '../unit-kernel/unit-kernel.contracts';

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

@Injectable()
export class BasicPriceRowResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceIdentity: ResourceIdentityResolutionService,
    private readonly unitKernel: UnitKernelService,
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
        sourceSection: ResourceType;
        sourceRowNumber: number;
        rawResourceCodeText: string | null;
        rawResourceNameText: string;
        rawUnitText: string | null;
      }>
    >(
      Prisma.sql`SELECT "id", "batchId", "version", "status", "proposedCanonicalPrice", "resourceCatalogId", "unitDefinitionId", "sourceSection", "sourceRowNumber", "rawResourceCodeText", "rawResourceNameText", "rawUnitText" FROM "basic_price_import_rows" WHERE "id" = ${rowId}::uuid FOR UPDATE`,
    );
    const row = rowLock[0];
    if (!row || row.batchId !== batchId)
      throw new NotFoundException('Row not found');
    if (row.status !== 'NEEDS_REVIEW')
      throw new ConflictException('ROW_NOT_MUTABLE');
    return { ...row, batch };
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
    return this.prisma.$transaction((tx) =>
      this.resolveWithinTransaction(
        tx,
        workspaceId,
        batchId,
        rowId,
        reviewerAccountId,
        dto,
      ),
    );
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
      // RM-02D1-REMEDIATION-V3.2.1 (Blocker 2): a row's sourceSection
      // (LABOR/MATERIAL/EQUIPMENT) is a hard type boundary — a LABOR row
      // can never be resolved to a MATERIAL or EQUIPMENT resource, even by
      // explicit human choice. This check runs before any row update and
      // before any mapping-decision insert, so a type-mismatched attempt
      // leaves zero trace in either table.
      if (resourceCatalog.type !== row.sourceSection)
        throw new ConflictException('RESOURCE_TYPE_MISMATCH');
      const unitDefinition = await tx.unitDefinition.findFirst({
        where: { id: dto.unitDefinitionId, isActive: true },
      });
      if (!unitDefinition)
        throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

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
      const [allCandidates, provenance] = await Promise.all([
        findMappingCandidates(
          tx,
          workspaceId,
          row.sourceSection,
          row.rawResourceNameText,
        ),
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

      // The signal set as it stood at DECISION TIME. On the ordinary resolve
      // path nothing is excluded and this is simply `allCandidates`.
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
   * Hand the authoritative verdict back verbatim rather than restating it.
   *
   * The reviewer asked "does SIMPROK know this?" and the answer is the whole
   * resolution — the candidates it found, why each was nominated, what a
   * previous human already decided about them. Collapsing that to a bare
   * error code would make the reviewer re-derive what the system already knows.
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
        candidates: identity.candidates,
        explanation: identity.explanation,
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
    return this.resourceIdentity.resolve(evidence, {
      rawName: row.rawResourceNameText,
      rawCode: row.rawResourceCodeText,
      rawUnit: row.rawUnitText,
      resourceType: row.sourceSection,
    });
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
    return this.prisma.$transaction(async (tx) => {
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
    });
  }
}
