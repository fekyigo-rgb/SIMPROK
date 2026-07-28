import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RejectBasicPriceImportRowDto, ResolveBasicPriceImportRowDto } from './dto/resolve-basic-price-import-row.dto';
import { findMappingCandidates } from './basic-price-row-mapping-candidates.service';
import { findProvenanceCandidate } from './basic-price-source-provenance.service';

@Injectable()
export class BasicPriceRowResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBatchRowMutable(tx: Prisma.TransactionClient, workspaceId: string, batchId: string, rowId: string) {
    const batchRows = await tx.$queryRaw<
      Array<{ id: string; workspaceId: string; sourceSha256: string; selectedSheetName: string; parserContractVersion: string }>
    >(
      Prisma.sql`SELECT "id", "workspaceId", "sourceSha256", "selectedSheetName", "parserContractVersion" FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid`,
    );
    const batch = batchRows[0];
    if (!batch || batch.workspaceId !== workspaceId) throw new NotFoundException('Batch not found');

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
    if (!row || row.batchId !== batchId) throw new NotFoundException('Row not found');
    if (row.status !== 'NEEDS_REVIEW') throw new ConflictException('ROW_NOT_MUTABLE');
    return { ...row, batch };
  }

  /**
   * Recompute the batch's aggregate state after a row transition (state
   * machine A: "NEEDS_REVIEW -> READY_FOR_REVIEW ... all rows resolved or
   * explicitly rejected"). Only NEEDS_REVIEW/READY_FOR_REVIEW batches are
   * touched — a batch already past submission is never reopened here.
   */
  private async recomputeBatchStatus(tx: Prisma.TransactionClient, batchId: string) {
    const [pendingCount, batch] = await Promise.all([
      tx.basicPriceImportRow.count({ where: { batchId, status: 'NEEDS_REVIEW' } }),
      tx.basicPriceImportBatch.findUniqueOrThrow({ where: { id: batchId } }),
    ]);
    if (batch.status !== 'NEEDS_REVIEW' && batch.status !== 'READY_FOR_REVIEW') return;
    const nextStatus = pendingCount === 0 ? 'READY_FOR_REVIEW' : 'NEEDS_REVIEW';
    if (nextStatus !== batch.status) {
      await tx.basicPriceImportBatch.update({ where: { id: batchId }, data: { status: nextStatus } });
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
  async resolveRow(workspaceId: string, batchId: string, rowId: string, reviewerAccountId: string, dto: ResolveBasicPriceImportRowDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.assertBatchRowMutable(tx, workspaceId, batchId, rowId);
      if (row.version !== dto.version) throw new ConflictException('ROW_VERSION_STALE');

      const resourceCatalog = await tx.resourceCatalog.findFirst({
        where: { id: dto.resourceCatalogId, workspaceId, status: 'ACTIVE' },
      });
      if (!resourceCatalog) throw new ConflictException('RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE');
      const unitDefinition = await tx.unitDefinition.findFirst({
        where: { id: dto.unitDefinitionId, isActive: true },
      });
      if (!unitDefinition) throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

      const priorSameIdentity = await tx.basicPriceImportRow.findFirst({
        where: {
          batchId,
          id: { not: rowId },
          resourceCatalogId: dto.resourceCatalogId,
          unitDefinitionId: dto.unitDefinitionId,
          status: { in: ['READY_FOR_SUBMISSION', 'NEEDS_REVIEW'] },
        },
      });

      let collisionType: 'NONE' | 'SAME_IDENTITY_SAME_VALUE' | 'SAME_IDENTITY_DIFFERENT_VALUE' = 'NONE';
      let collisionOfRowId: string | null = null;
      if (priorSameIdentity) {
        collisionOfRowId = priorSameIdentity.id;
        collisionType =
          priorSameIdentity.proposedCanonicalPrice?.toString() === row.proposedCanonicalPrice?.toString()
            ? 'SAME_IDENTITY_SAME_VALUE'
            : 'SAME_IDENTITY_DIFFERENT_VALUE';
      }

      const canSubmit = collisionType === 'NONE' && row.proposedCanonicalPrice !== null;
      const updated = await tx.basicPriceImportRow.update({
        where: { id: rowId },
        data: {
          resourceCatalogId: dto.resourceCatalogId,
          resolvedResourceType: resourceCatalog.type,
          unitDefinitionId: dto.unitDefinitionId,
          collisionType,
          collisionOfRowId,
          resolutionStatus: canSubmit ? 'RESOLVED' : collisionType !== 'NONE' ? 'RESOURCE_AMBIGUOUS' : 'UNRESOLVED',
          status: canSubmit ? 'READY_FOR_SUBMISSION' : 'NEEDS_REVIEW',
          resolvedByAccountId: reviewerAccountId,
          resolvedAt: new Date(),
          version: { increment: 1 },
        },
      });

      // RM-02D1-REMEDIATION-V3.1: SOURCE_ROW_PROVENANCE > SINGLE > MULTIPLE >
      // MANUAL_SEARCH. Provenance is fail-closed (findProvenanceCandidate
      // returns null candidate for every row unless a human-authorized
      // BasicPriceSourceEquivalence exists for this exact batch source
      // hash) — never a cross-hash guess. When provenance and normalized
      // name disagree on the identity, that is recorded as
      // PROVENANCE_NAME_CONFLICT regardless of which side dto.resourceCatalogId
      // matches, so the audit trail can find every row where the two
      // signals disagreed, not just the ones where provenance "won".
      const [candidates, provenance] = await Promise.all([
        findMappingCandidates(tx, workspaceId, row.sourceSection, row.rawResourceNameText),
        findProvenanceCandidate(tx, {
          workspaceId,
          batchSourceSha256: row.batch.sourceSha256,
          sheetName: row.batch.selectedSheetName,
          parserContractVersion: row.batch.parserContractVersion,
          sourceRowNumber: row.sourceRowNumber,
          rawResourceCodeText: row.rawResourceCodeText,
          rawResourceNameText: row.rawResourceNameText,
          rawUnitText: row.rawUnitText,
        }),
      ]);

      const provenanceCandidateId = provenance.candidate?.resourceCatalogId ?? null;
      // A conflict requires normalized-name matching to have independently
      // found something to disagree with — zero name candidates is not a
      // conflict, it is simply an unconfirmed (but still authoritative)
      // provenance signal.
      const hasConflict = provenanceCandidateId !== null && candidates.length > 0 && !candidates.some((c) => c.resourceCatalogId === provenanceCandidateId);
      const matchedNameCandidate = candidates.some((c) => c.resourceCatalogId === dto.resourceCatalogId);

      let suggestionSource:
        | 'SOURCE_ROW_PROVENANCE'
        | 'PROVENANCE_NAME_CONFLICT'
        | 'NORMALIZED_NAME_SINGLE_CANDIDATE'
        | 'NORMALIZED_NAME_MULTIPLE_CANDIDATES'
        | 'MANUAL_SEARCH';
      if (hasConflict) {
        suggestionSource = 'PROVENANCE_NAME_CONFLICT';
      } else if (provenanceCandidateId !== null) {
        suggestionSource = 'SOURCE_ROW_PROVENANCE';
      } else if (matchedNameCandidate && candidates.length === 1) {
        suggestionSource = 'NORMALIZED_NAME_SINGLE_CANDIDATE';
      } else if (matchedNameCandidate && candidates.length > 1) {
        suggestionSource = 'NORMALIZED_NAME_MULTIPLE_CANDIDATES';
      } else {
        suggestionSource = 'MANUAL_SEARCH';
      }

      // "How many distinct identities did the reviewer actually see as
      // signals" — dedups provenance against an agreeing name candidate,
      // and counts both sides separately when they conflict.
      const distinctSignalIds = new Set(candidates.map((c) => c.resourceCatalogId));
      if (provenanceCandidateId !== null) distinctSignalIds.add(provenanceCandidateId);

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
    });
  }

  /** Human rejection (state machine B, reason required, no automatic path). */
  async rejectRow(workspaceId: string, batchId: string, rowId: string, dto: RejectBasicPriceImportRowDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.assertBatchRowMutable(tx, workspaceId, batchId, rowId);
      if (row.version !== dto.version) throw new ConflictException('ROW_VERSION_STALE');

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
