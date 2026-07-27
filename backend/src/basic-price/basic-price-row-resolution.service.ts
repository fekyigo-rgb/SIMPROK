import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RejectBasicPriceImportRowDto, ResolveBasicPriceImportRowDto } from './dto/resolve-basic-price-import-row.dto';

@Injectable()
export class BasicPriceRowResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBatchRowMutable(tx: Prisma.TransactionClient, workspaceId: string, batchId: string, rowId: string) {
    const batchRows = await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>(
      Prisma.sql`SELECT "id", "workspaceId" FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid`,
    );
    const batch = batchRows[0];
    if (!batch || batch.workspaceId !== workspaceId) throw new NotFoundException('Batch not found');

    const rowLock = await tx.$queryRaw<
      Array<{ id: string; batchId: string; version: number; status: string; proposedCanonicalPrice: Prisma.Decimal | null; resourceCatalogId: string | null; unitDefinitionId: string | null }>
    >(Prisma.sql`SELECT "id", "batchId", "version", "status", "proposedCanonicalPrice", "resourceCatalogId", "unitDefinitionId" FROM "basic_price_import_rows" WHERE "id" = ${rowId}::uuid FOR UPDATE`);
    const row = rowLock[0];
    if (!row || row.batchId !== batchId) throw new NotFoundException('Row not found');
    if (row.status !== 'NEEDS_REVIEW') throw new ConflictException('ROW_NOT_MUTABLE');
    return row;
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
   */
  async resolveRow(workspaceId: string, batchId: string, rowId: string, dto: ResolveBasicPriceImportRowDto) {
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
          resolvedByAccountId: null, // set by controller layer once actor plumbing exists; not fabricated here
          resolvedAt: new Date(),
          version: { increment: 1 },
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
