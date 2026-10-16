import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { IsInt, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ResourceObservationService } from '../resource-catalog/resource-observation.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import { BasicPriceRowResolutionProposalService } from './basic-price-row-resolution-proposal.service';

export class RequestIdentityReviewDto {
  @IsInt() @Min(0) version!: number;
}

/**
 * One missing WIRING seam, not a second identity decision engine.
 *
 * The user of Basic Price asks for review of a BLOCKED candidate. The existing
 * shared observation lifecycle receives the source row and its candidates.
 * Only the authorized curator can decide existing vs genuinely new.
 * This service never creates ResourceCatalog, changes a Basic Price row,
 * approves an observation, or expands curator permissions.
 */
@Injectable()
export class BasicPriceIdentityReviewBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: BasicPriceRowResolutionProposalService,
    private readonly observations: ResourceObservationService,
  ) {}

  private async ownedBatch(workspaceId: string, batchId: string, actorAccountId: string) {
    const batch = await this.prisma.basicPriceImportBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true, workspaceId: true, uploadedByAccountId: true, status: true,
        sourceSha256: true, sourceFileName: true,
        selectedSheetName: true, parserContractVersion: true,
      },
    });
    if (!batch || batch.workspaceId !== workspaceId) throw new NotFoundException('Batch not found');
    assertBatchOwnedByCaller(batch, actorAccountId, 'Batch not found');
    return batch;
  }

  private observationWhere(
    workspaceId: string,
    batch: { sourceSha256: string; selectedSheetName: string },
    row: { sourceRowNumber: number; rawResourceNameText: string; sourceSection: string | null },
  ) {
    return {
      workspaceId,
      origin: 'BASIC_PRICE',
      sourceSha256: batch.sourceSha256,
      sheetName: batch.selectedSheetName,
      sourceRowNumber: row.sourceRowNumber,
      rawName: row.rawResourceNameText,
      resourceType: row.sourceSection as ResourceType,
    };
  }

  /** One scoped read, never a row-linear set of HTTP requests. */
  async statuses(workspaceId: string, batchId: string, actorAccountId: string) {
    const batch = await this.ownedBatch(workspaceId, batchId, actorAccountId);
    const rows = await this.prisma.basicPriceImportRow.findMany({
      where: { batchId },
      select: {
        id: true, sourceRowNumber: true, rawResourceNameText: true, sourceSection: true,
      },
    });
    if (rows.length === 0) return { rows: {} };
    const observed = await this.prisma.observedResource.findMany({
      where: {
        workspaceId,
        origin: 'BASIC_PRICE',
        sourceSha256: batch.sourceSha256,
        sheetName: batch.selectedSheetName,
        sourceRowNumber: { in: [...new Set(rows.map((row) => row.sourceRowNumber))] },
      },
      select: {
        sourceRowNumber: true, rawName: true, resourceType: true,
        status: true, resolvedResourceCatalogId: true,
      },
    });
    const decidedIds = [...new Set(observed.flatMap((item) =>
      item.resolvedResourceCatalogId ? [item.resolvedResourceCatalogId] : [],
    ))];
    // Reveal a curator-chosen identity only if CURRENTLY active and visible
    // to this workspace. Curation does not override catalog visibility law.
    const catalogs = decidedIds.length > 0
      ? await this.prisma.resourceCatalog.findMany({
          where: {
            id: { in: decidedIds },
            status: 'ACTIVE',
            OR: [{ workspaceId }, { workspaceId: null }],
          },
          select: {
            id: true, code: true, name: true, type: true,
            baseUnit: true, status: true,
          },
        })
      : [];
    const visible = new Map(catalogs.map((item) => [item.id, item]));
    const key = (n: number | null, name: string, type: string | null) =>
      JSON.stringify([n, name, type]);
    const states = new Map(observed.map((item) => [
      key(item.sourceRowNumber, item.rawName, item.resourceType),
      {
        status: item.status,
        resource: item.resolvedResourceCatalogId
          ? visible.get(item.resolvedResourceCatalogId) ?? null
          : null,
      },
    ]));
    return {
      rows: Object.fromEntries(rows.map((row) => {
        const state = row.sourceSection
          ? states.get(key(row.sourceRowNumber, row.rawResourceNameText, row.sourceSection))
          : null;
        // Even an authorized curator cannot silently re-type the source row.
        // A cross-family answer is retained as a decision, but not selectable
        // until the row itself is lawfully reconciled.
        const safe = state?.resource && state.resource.type !== row.sourceSection
          ? { ...state, resource: null }
          : state ?? { status: 'NOT_REQUESTED', resource: null };
        return [row.id, safe];
      })),
    };
  }

  /** Explicit and idempotent user request. No auto-approval, no catalog write. */
  async request(
    workspaceId: string, batchId: string, rowId: string,
    actorAccountId: string, expectedVersion: number,
  ) {
    const batch = await this.ownedBatch(workspaceId, batchId, actorAccountId);
    if (!['NEEDS_REVIEW', 'READY_FOR_REVIEW'].includes(batch.status)) {
      throw new ConflictException('BATCH_NOT_MUTABLE');
    }
    const row = await this.prisma.basicPriceImportRow.findFirst({
      where: { id: rowId, batchId },
      select: {
        id: true, batchId: true, version: true, status: true, sourceSection: true,
        sourceSectionProvenance: true, reasonCodes: true,
        rawResourceNameText: true, rawResourceCodeText: true, rawUnitText: true,
        sourceRowNumber: true, sourceCodeCellAddress: true,
        sourceNameCellAddress: true, sourceUnitCellAddress: true,
      },
    });
    if (!row) throw new NotFoundException('Row not found');
    if (row.version !== expectedVersion) throw new ConflictException('ROW_VERSION_STALE');
    if (row.status !== 'NEEDS_REVIEW') throw new ConflictException('ROW_NOT_MUTABLE');
    if (!row.sourceSection) throw new ConflictException('CATEGORY_CONFIRMATION_REQUIRED');
    // A legacy, file-wide hint is not a fact about this row. Require the actual
    // per-row confirmation introduced in PR205 before creating curator work.
    const sourceProven = ['SOURCE_ROW_CATEGORY', 'SOURCE_SECTION_TITLE'].includes(
      row.sourceSectionProvenance ?? '',
    );
    const humanConfirmed = row.reasonCodes.includes('ROW_CATEGORY_CONFIRMED_BY_REVIEWER');
    if (!sourceProven && !humanConfirmed) {
      throw new ConflictException('CATEGORY_CONFIRMATION_REQUIRED');
    }

    const where = this.observationWhere(workspaceId, batch, row);
    const previously = await this.prisma.observedResource.findFirst({
      where, select: { status: true },
    });
    if (previously) return { rowId, status: previously.status, unchanged: true };

    // The existing authority, not the client, recomputes whether a strong
    // candidate actually prevents admission NOW. No identity is accepted here.
    const proposal = (await this.proposals.proposeForRows(workspaceId, [{
      id: row.id, batchId, rowVersion: row.version,
      sourceSha256: batch.sourceSha256,
      sourceSection: row.sourceSection,
      sourceSectionProvenance: row.sourceSectionProvenance,
      rawResourceNameText: row.rawResourceNameText,
      rawResourceCodeText: row.rawResourceCodeText,
      rawUnitText: row.rawUnitText,
    }])).get(row.id);
    const review = proposal?.resource.admissionReview;
    if (review?.reasonCode !== 'IDENTITY_CANDIDATE_BLOCKED' ||
        review.blockedCandidateIds.length === 0) {
      throw new ConflictException('IDENTITY_REVIEW_NOT_REQUIRED');
    }
    // A second version read prevents a stale decision from creating new work.
    const versionNow = await this.prisma.basicPriceImportRow.findFirst({
      where: { id: row.id, batchId },
      select: { version: true, status: true, sourceSection: true },
    });
    if (!versionNow || versionNow.version !== expectedVersion ||
        versionNow.status !== 'NEEDS_REVIEW' ||
        versionNow.sourceSection !== row.sourceSection) {
      throw new ConflictException('ROW_VERSION_STALE');
    }
    await this.observations.observeMany([{
      workspaceId, origin: 'BASIC_PRICE',
      resourceType: row.sourceSection as ResourceType,
      rawName: row.rawResourceNameText,
      rawCode: row.rawResourceCodeText,
      rawUnit: row.rawUnitText,
      candidates: review.blockedCandidateIds,
      provenance: {
        sourceSha256: batch.sourceSha256,
        sourceFileName: batch.sourceFileName,
        parserContractVersion: batch.parserContractVersion,
        sheetName: batch.selectedSheetName,
        sourceRowNumber: row.sourceRowNumber,
        sourceCodeCellAddress: row.sourceCodeCellAddress,
        sourceNameCellAddress: row.sourceNameCellAddress,
        sourceUnitCellAddress: row.sourceUnitCellAddress,
      },
    }]);
    // Existing unique identity makes two simultaneous requests idempotent.
    const current = await this.prisma.observedResource.findFirst({
      where, select: { status: true },
    });
    if (!current) throw new ConflictException('IDENTITY_REVIEW_NOT_CONFIRMED');
    return { rowId, status: current.status, unchanged: false };
  }
}
