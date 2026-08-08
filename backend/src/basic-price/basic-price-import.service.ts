import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BASIC_PRICE_PARSER_CONTRACT_VERSION,
  BasicPriceImportKnowledgeObject,
  BasicPriceXlsxIntakeAdapter,
} from './basic-price-xlsx-intake.adapter';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { UpdateBasicPriceImportBatchDto } from './dto/update-basic-price-import-batch.dto';
import { PriceSubmissionReviewService } from '../reality-intake/price-submission-review.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';

export const MAX_UPLOAD_BYTES = 10_485_760;
type UploadedXlsx = {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype?: string;
};

// Every mutable batch field is a fingerprint input (schema contract §5):
// same workbook + different region/date/source/coverage MUST produce a
// different fingerprint, never silently reuse an existing batch.
const FINGERPRINT_METADATA_KEYS = [
  'regionId',
  'effectiveDate',
  'sourceType',
  'sourceOrigin',
  'sourceOrganizationName',
  'sourceVendorName',
  // RM-03D1: temporal provenance is a mutable batch fact, so it belongs in the
  // fingerprint for the same reason the date does — the same workbook described
  // with a different provenance claim is a different batch, never a silent reuse
  // of one that claimed something else.
  'sourcePeriodLabel',
  'effectiveDateProvenance',
  'effectiveDateDerivationRule',
  'priceCoverageDeclared',
  'transportIncluded',
  'loadingIncluded',
  'unloadingIncluded',
  'deliveredToProject',
] as const;

@Injectable()
export class BasicPriceImportService {
  private readonly adapter = new BasicPriceXlsxIntakeAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: PriceSubmissionReviewService,
  ) {}

  private validateFile(
    file: UploadedXlsx | undefined,
  ): asserts file is UploadedXlsx {
    if (!file?.buffer) throw new BadRequestException('XLSX file is required');
    if (file.size > MAX_UPLOAD_BYTES)
      throw new PayloadTooLargeException('XLSX file exceeds 10 MiB');
    if (!file.originalname.toLowerCase().endsWith('.xlsx'))
      throw new BadRequestException('Only XLSX files are accepted');
  }

  private async parse(
    file: UploadedXlsx,
    selectedSheet?: string,
  ): Promise<BasicPriceImportKnowledgeObject> {
    try {
      return await this.adapter.parse(
        file.buffer,
        file.originalname,
        selectedSheet,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_XLSX';
      if (message === 'SOURCE_ROW_LIMIT_EXCEEDED')
        throw new PayloadTooLargeException(message);
      throw new BadRequestException(message);
    }
  }

  private fingerprint(
    workspaceId: string,
    organizationId: string,
    knowledge: BasicPriceImportKnowledgeObject,
    metadata: PreviewBasicPriceImportDto,
  ): string {
    const metadataPart = FINGERPRINT_METADATA_KEYS.map(
      (key) => `${key}:${(metadata as Record<string, unknown>)[key] ?? ''}`,
    ).join('|');
    return createHash('sha256')
      .update(
        [
          workspaceId,
          organizationId,
          knowledge.sourceSha256,
          knowledge.sheetName,
          BASIC_PRICE_PARSER_CONTRACT_VERSION,
          metadataPart,
        ].join('|'),
      )
      .digest('hex')
      .toUpperCase();
  }

  private async resolveOrganizationId(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace.organizationId;
  }

  private summarize(
    batch: {
      id: string;
      status: string;
      importFingerprint: string;
      effectiveDate: Date | null;
      regionId: string | null;
      version: number;
    },
    rows: Array<{
      id: string;
      status: string;
      resolutionStatus: string;
      rawResourceCodeText?: string | null;
      rawResourceNameText: string;
      rawUnitText?: string | null;
      rawPriceDisplayText?: string | null;
      proposedCanonicalPrice?: { toString(): string } | null;
      sourceSection: string;
      sourceRowNumber: number;
      collisionType?: string;
      collisionOfRowId?: string | null;
      resourceCatalogId?: string | null;
      unitDefinitionId?: string | null;
      reasonCodes?: string[];
      version?: number;
    }>,
  ) {
    return {
      batchId: batch.id,
      status: batch.status,
      importFingerprint: batch.importFingerprint,
      effectiveDate: batch.effectiveDate,
      regionId: batch.regionId,
      version: batch.version,
      totalRows: rows.length,
      needsReviewRows: rows.filter((r) => r.status === 'NEEDS_REVIEW').length,
      readyForSubmissionRows: rows.filter(
        (r) => r.status === 'READY_FOR_SUBMISSION',
      ).length,
      rejectedRows: rows.filter((r) => r.status === 'REJECTED').length,
      submittedRows: rows.filter((r) => r.status === 'SUBMISSION_CREATED')
        .length,
      // Every field a human needs to actually resolve a row (assign
      // resource/unit identity, judge a collision) — not just a status
      // label — since this projection is the only row data the review UI
      // ever receives.
      rows: rows.map((r) => ({
        id: r.id,
        status: r.status,
        resolutionStatus: r.resolutionStatus,
        code: r.rawResourceCodeText ?? null,
        name: r.rawResourceNameText,
        unit: r.rawUnitText ?? null,
        rawPriceDisplayText: r.rawPriceDisplayText ?? null,
        proposedCanonicalPrice: r.proposedCanonicalPrice
          ? r.proposedCanonicalPrice.toString()
          : null,
        section: r.sourceSection,
        sourceRowNumber: r.sourceRowNumber,
        collisionType: r.collisionType ?? 'NONE',
        collisionOfRowId: r.collisionOfRowId ?? null,
        resourceCatalogId: r.resourceCatalogId ?? null,
        unitDefinitionId: r.unitDefinitionId ?? null,
        reasonCodes: r.reasonCodes ?? [],
        version: r.version ?? 0,
      })),
    };
  }

  /**
   * Creates a persisted BasicPriceImportBatch + BasicPriceImportRow set
   * from a workbook (state machine A: (none) -> PREVIEWED, immediately
   * followed by the automatic PREVIEWED -> ... -> NEEDS_REVIEW transition,
   * computed inline rather than left transiently stale — no row can be
   * RESOLVED at parse time, since resolution requires a human-driven
   * ResourceCatalog/UnitDefinition lookup this adapter has no access to).
   * REPLAY_POLICY (§12.1): an exact fingerprint replay returns the
   * existing batch, never duplicate rows.
   */
  async preview(
    workspaceId: string,
    uploadedByAccountId: string,
    file: UploadedXlsx | undefined,
    metadata: PreviewBasicPriceImportDto,
  ) {
    this.validateFile(file);
    const knowledge = await this.parse(file, metadata.selectedSheet);
    const organizationId = await this.resolveOrganizationId(workspaceId);
    const fingerprint = this.fingerprint(
      workspaceId,
      organizationId,
      knowledge,
      metadata,
    );

    const existing = await this.prisma.basicPriceImportBatch.findUnique({
      where: {
        workspaceId_importFingerprint: {
          workspaceId,
          importFingerprint: fingerprint,
        },
      },
    });
    if (existing) {
      const rows = await this.prisma.basicPriceImportRow.findMany({
        where: { batchId: existing.id },
      });
      return this.summarize(existing, rows);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const batch = await tx.basicPriceImportBatch.create({
          data: {
            workspaceId,
            organizationId,
            uploadedByAccountId,
            sourceFileName: knowledge.fileName,
            sourceSha256: knowledge.sourceSha256,
            sourceByteLength: file.size,
            selectedSheetName: knowledge.sheetName,
            parserContractVersion: knowledge.parserContractVersion,
            regionId: metadata.regionId ?? null,
            effectiveDate: metadata.effectiveDate
              ? new Date(metadata.effectiveDate)
              : null,
            sourceType: metadata.sourceType ?? null,
            sourceOrigin: metadata.sourceOrigin ?? null,
            sourceOrganizationName: metadata.sourceOrganizationName ?? null,
            sourceVendorName: metadata.sourceVendorName ?? null,
            // RM-03D1 — temporal provenance. Null means unknown, which never
            // reads as "the source stated this date".
            sourcePeriodLabel: metadata.sourcePeriodLabel ?? null,
            effectiveDateProvenance: metadata.effectiveDateProvenance ?? null,
            effectiveDateDerivationRule:
              metadata.effectiveDateDerivationRule ?? null,
            priceCoverageDeclared: metadata.priceCoverageDeclared ?? false,
            transportIncluded: metadata.transportIncluded ?? null,
            loadingIncluded: metadata.loadingIncluded ?? null,
            unloadingIncluded: metadata.unloadingIncluded ?? null,
            deliveredToProject: metadata.deliveredToProject ?? null,
            importFingerprint: fingerprint,
            // Every row is created NEEDS_REVIEW below (resolution is always
            // a separate human step) — the batch reflects that immediately,
            // consistent with state machine A's automatic transition chain.
            status: 'NEEDS_REVIEW',
          },
        });

        const createdRows: Prisma.BasicPriceImportRowGetPayload<
          Record<string, never>
        >[] = [];
        for (const row of knowledge.rows) {
          const created = await tx.basicPriceImportRow.create({
            data: {
              batchId: batch.id,
              sourceSection: row.sourceSection,
              sourceRowNumber: row.sourceRowNumber,
              sourceCodeCellAddress: row.sourceCodeCellAddress,
              sourceNameCellAddress: row.sourceNameCellAddress,
              sourceUnitCellAddress: row.sourceUnitCellAddress,
              sourcePriceCellAddress: row.sourcePriceCellAddress,
              rawResourceCodeText: row.rawResourceCodeText,
              rawResourceNameText: row.rawResourceNameText,
              rawUnitText: row.rawUnitText,
              rawPriceCellType: row.rawPriceCellType,
              rawPriceNumericRoundTripString:
                row.rawPriceNumericRoundTripString,
              rawPriceTextValue: row.rawPriceTextValue,
              rawPriceFormulaText: row.rawPriceFormulaText,
              rawPriceCachedResultRoundTripString:
                row.rawPriceCachedResultRoundTripString,
              rawPriceFormulaError: row.rawPriceFormulaError,
              rawPriceNumberFormat: row.rawPriceNumberFormat,
              rawPriceDisplayText: row.rawPriceDisplayText,
              proposedCanonicalPrice: row.proposedCanonicalPrice,
              canonicalRoundingMode: row.canonicalRoundingMode,
              resolutionStatus: 'UNRESOLVED',
              status: 'NEEDS_REVIEW',
              reasonCodes: [...row.warnings, ...row.errors],
            },
          });
          createdRows.push(created);
        }

        const finalItemCount = await tx.basicPriceImportRow.count({
          where: { batchId: batch.id },
        });
        if (finalItemCount !== createdRows.length)
          throw new ConflictException('IMPORT_ROW_COUNT_MISMATCH');

        return this.summarize(batch, createdRows);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Concurrent identical request already created it (I04/I05) --
        // re-read the winner rather than error or duplicate.
        const winner =
          await this.prisma.basicPriceImportBatch.findUniqueOrThrow({
            where: {
              workspaceId_importFingerprint: {
                workspaceId,
                importFingerprint: fingerprint,
              },
            },
          });
        const winnerRows = await this.prisma.basicPriceImportRow.findMany({
          where: { batchId: winner.id },
        });
        return this.summarize(winner, winnerRows);
      }
      throw error;
    }
  }

  /**
   * Update batch metadata (region/date/source/coverage) — only while the
   * batch is still mutable (NEEDS_REVIEW/READY_FOR_REVIEW). Optimistic
   * `version` check fails closed on staleness (test matrix I06).
   */
  async updateBatchMetadata(
    workspaceId: string,
    batchId: string,
    dto: UpdateBasicPriceImportBatchDto,
    currentAccountId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          status: string;
          version: number;
          uploadedByAccountId: string;
        }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "status", "version", "uploadedByAccountId" FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`,
      );
      const batch = locked[0];
      if (!batch || batch.workspaceId !== workspaceId)
        throw new NotFoundException('Batch not found');
      assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');
      if (batch.version !== dto.version)
        throw new ConflictException('BATCH_VERSION_STALE');
      if (
        batch.status !== 'NEEDS_REVIEW' &&
        batch.status !== 'READY_FOR_REVIEW'
      ) {
        throw new ConflictException('BATCH_NOT_MUTABLE');
      }

      const updated = await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: {
          regionId: dto.regionId ?? undefined,
          effectiveDate: dto.effectiveDate
            ? new Date(dto.effectiveDate)
            : undefined,
          sourceType: dto.sourceType ?? undefined,
          sourceOrigin: dto.sourceOrigin ?? undefined,
          sourceOrganizationName: dto.sourceOrganizationName ?? undefined,
          sourceVendorName: dto.sourceVendorName ?? undefined,
          // RM-03D1 — temporal provenance, under the same
          // omitted-means-unchanged rule as every other field here.
          sourcePeriodLabel: dto.sourcePeriodLabel ?? undefined,
          effectiveDateProvenance: dto.effectiveDateProvenance ?? undefined,
          effectiveDateDerivationRule:
            dto.effectiveDateDerivationRule ?? undefined,
          priceCoverageDeclared: dto.priceCoverageDeclared ?? undefined,
          transportIncluded: dto.transportIncluded ?? undefined,
          loadingIncluded: dto.loadingIncluded ?? undefined,
          unloadingIncluded: dto.unloadingIncluded ?? undefined,
          deliveredToProject: dto.deliveredToProject ?? undefined,
          version: { increment: 1 },
        },
      });
      const rows = await tx.basicPriceImportRow.findMany({
        where: { batchId },
      });
      return this.summarize(updated, rows);
    });
  }

  async getBatch(
    workspaceId: string,
    batchId: string,
    currentAccountId: string,
  ) {
    const batch = await this.prisma.basicPriceImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.workspaceId !== workspaceId)
      throw new NotFoundException('Batch not found');
    assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');
    const rows = await this.prisma.basicPriceImportRow.findMany({
      where: { batchId },
      orderBy: { sourceRowNumber: 'asc' },
    });
    return this.summarize(batch, rows);
  }

  /**
   * Batch approval (state machine A: READY_FOR_REVIEW -> APPROVED_FOR_SUBMISSION
   * -> SUBMITTED/PARTIALLY_SUBMITTED). Preconditions: effectiveDate and
   * regionId set (schema contract §12.2), plus sourceOrigin set — a
   * structural necessity this design's precondition list did not spell
   * out: PriceSubmission.sourceOrigin has no schema default and is never
   * fabricated. Idempotent: already-submitted batches return their
   * existing state, never re-process.
   */
  async submitBatch(
    workspaceId: string,
    batchId: string,
    currentAccountId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          organizationId: string;
          status: string;
          effectiveDate: Date | null;
          regionId: string | null;
          sourceType: string | null;
          sourceOrigin: string | null;
          uploadedByAccountId: string;
        }>
      >(
        Prisma.sql`SELECT * FROM "basic_price_import_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`,
      );
      const batch = locked[0];
      if (!batch || batch.workspaceId !== workspaceId)
        throw new NotFoundException('Batch not found');
      assertBatchOwnedByCaller(batch, currentAccountId, 'Batch not found');

      if (
        [
          'APPROVED_FOR_SUBMISSION',
          'PARTIALLY_SUBMITTED',
          'SUBMITTED',
        ].includes(batch.status)
      ) {
        const rows = await tx.basicPriceImportRow.findMany({
          where: { batchId },
        });
        return this.summarize(batch as any, rows);
      }
      if (batch.status !== 'READY_FOR_REVIEW')
        throw new ConflictException('BATCH_NOT_READY_FOR_REVIEW');
      if (!batch.effectiveDate)
        throw new ConflictException(
          'EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION',
        );
      if (!batch.regionId)
        throw new ConflictException('REGION_REQUIRED_BEFORE_SUBMISSION');
      if (!batch.sourceOrigin)
        throw new ConflictException('SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION');

      const readyRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "basic_price_import_rows" WHERE "batchId" = ${batchId}::uuid AND "status" = 'READY_FOR_SUBMISSION' FOR UPDATE`,
      );
      if (readyRows.length === 0)
        throw new ConflictException('NO_ROWS_READY_FOR_SUBMISSION');

      await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: { status: 'APPROVED_FOR_SUBMISSION' },
      });

      for (const { id: rowId } of readyRows) {
        const row = await tx.basicPriceImportRow.findUniqueOrThrow({
          where: { id: rowId },
        });
        if (!row.resourceCatalogId || !row.proposedCanonicalPrice)
          throw new ConflictException('ROW_NOT_RESOLVED');

        const submission = await tx.priceSubmission.create({
          data: {
            workspaceId: batch.workspaceId,
            organizationId: batch.organizationId,
            resourceId: row.resourceCatalogId,
            regionId: batch.regionId,
            reportedByAccountId: batch.uploadedByAccountId,
            sourceOrigin: batch.sourceOrigin as any,
            sourceType: (batch.sourceType as any) ?? 'MARKET_SURVEY',
            status: 'SUBMITTED',
          },
        });

        const revision = await tx.priceSubmissionRevision.create({
          data: {
            submissionId: submission.id,
            revisionNumber: 1,
            value: new Prisma.Decimal(row.proposedCanonicalPrice),
            effectiveDate: row.effectiveDateOverride ?? batch.effectiveDate,
            validationPassed: true,
          },
        });

        await tx.priceSubmission.update({
          where: { id: submission.id },
          data: { currentRevisionId: revision.id },
        });

        await tx.priceSubmissionAudit.create({
          data: {
            submissionId: submission.id,
            fromStatus: null,
            toStatus: 'SUBMITTED',
            actorType: 'SYSTEM',
            actorAccountId: null,
            reason: `RM02_IMPORT_SUBMISSION; batchId:${batch.id}; rowId:${row.id}`,
          },
        });

        // RM-02D2A-1 Work Package A: create the PriceSubmissionReview in the
        // SAME transaction, via the one canonical helper. If review creation
        // fails, this whole batch-submission transaction rolls back — no
        // PriceSubmission is ever left orphaned without a review.
        await this.reviewService.createReviewWithinTransaction(tx, {
          id: submission.id,
          workspaceId: batch.workspaceId,
          organizationId: batch.organizationId,
        });

        await tx.basicPriceImportRow.update({
          where: { id: row.id },
          data: {
            priceSubmissionId: submission.id,
            status: 'SUBMISSION_CREATED',
          },
        });
      }

      const rejectedCount = await tx.basicPriceImportRow.count({
        where: { batchId, status: 'REJECTED' },
      });
      const finalStatus =
        rejectedCount > 0 ? 'PARTIALLY_SUBMITTED' : 'SUBMITTED';
      const finalBatch = await tx.basicPriceImportBatch.update({
        where: { id: batchId },
        data: { status: finalStatus, reviewedAt: new Date() },
      });

      const finalRows = await tx.basicPriceImportRow.findMany({
        where: { batchId },
      });
      const finalSubmittedCount = finalRows.filter(
        (r) => r.status === 'SUBMISSION_CREATED',
      ).length;
      if (finalSubmittedCount !== readyRows.length)
        throw new ConflictException('ROW_SUBMISSION_COUNT_MISMATCH');

      return this.summarize(finalBatch, finalRows);
    });
  }
}
