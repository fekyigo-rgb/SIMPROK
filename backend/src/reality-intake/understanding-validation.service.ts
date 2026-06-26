import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  IntakeJob,
  ExtractionArtifact,
  PriceSourceOrigin,
  ValidationStatus,
  KnowledgeLifecycleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type UnderstandingJob = IntakeJob & {
  extractionArtifacts: ExtractionArtifact[];
};

type RawRow = {
  rowNumber?: number;
  values?: unknown[];
};

type ColumnRole = 'resource' | 'unit' | 'price' | 'sourceOrigin';

interface ClaimRow {
  id: string;
  version: number;
}

interface DetectedColumn {
  role: ColumnRole;
  columnIndex: number;
  headerValue: unknown;
}

interface RowValidation {
  status: ValidationStatus;
  lifecycleStatus: KnowledgeLifecycleStatus;
  confidence: number;
  messages: string;
  canonicalPayload?: {
    resourceRef: string;
    value: number;
    unit: string;
    sourceOrigin: PriceSourceOrigin;
  };
}

export type UnderstandingValidationResult =
  | { processed: false; reason: 'NO_JOB' }
  | {
      processed: true;
      intakeJobId: string;
      status: 'NEEDS_REVIEW' | 'FAILED';
      candidatesCreated: number;
      errorCode?: string;
    };

const HEADER_DICTIONARY: Record<ColumnRole, string[]> = {
  resource: [
    'uraian',
    'item',
    'deskripsi',
    'description',
    'material',
    'resource',
    'nama barang',
    'nama bahan',
  ],
  unit: ['satuan', 'unit', 'uom', 'sat'],
  price: ['harga', 'price', 'nilai', 'value', 'harga satuan'],
  sourceOrigin: [
    'sourceorigin',
    'source_origin',
    'sumber',
    'asal',
    'asal harga',
    'source',
    'origin',
  ],
};

const VALID_SOURCE_ORIGINS = new Set<string>(
  Object.values(PriceSourceOrigin),
);

@Injectable()
export class UnderstandingValidationService
  implements OnModuleInit, OnModuleDestroy
{
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.INTAKE_UNDERSTANDING_WORKER_ENABLED !== 'true') {
      return;
    }

    this.interval = setInterval(() => {
      void this.processOnce().catch((error) => {
        console.error('reality-intake.understanding.worker_error', {
          errorCode: 'UNDERSTANDING_PROCESS_ONCE_FAILED',
          reason: error instanceof Error ? error.message : String(error),
          stage: 'UNDERSTANDING_VALIDATION',
        });
      });
    }, Number(process.env.INTAKE_UNDERSTANDING_WORKER_INTERVAL_MS ?? 5000));
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async processOnce(): Promise<UnderstandingValidationResult> {
    const job = await this.claimNextJob();
    if (!job) {
      return { processed: false, reason: 'NO_JOB' };
    }

    const artifact = job.extractionArtifacts[0];
    if (!artifact) {
      return this.failJob(job, 'EXTRACTION_ARTIFACT_MISSING', 'No extraction artifact found');
    }

    try {
      const rawRows = this.asRawRows(artifact.rawRows);
      const detectedColumns = this.detectColumns(rawRows);
      const dataRows = rawRows.slice(1).filter((row) => this.hasAnyValue(row));

      const result = await this.prisma.$transaction(async (tx) => {
        const existingCandidateCount = await tx.knowledgeCandidate.count({
          where: { intakeJobId: job.id },
        });

        if (existingCandidateCount > 0) {
          await tx.intakeJob.update({
            where: { id: job.id },
            data: { status: 'NEEDS_REVIEW' },
          });

          return { candidatesCreated: 0 };
        }

        let candidatesCreated = 0;

        for (const row of dataRows) {
          const validation = this.validateRow(row, detectedColumns);
          const canonicalPricePoint = validation.canonicalPayload
            ? await tx.canonicalPricePoint.create({
                data: {
                  resourceRef: validation.canonicalPayload.resourceRef,
                  value: validation.canonicalPayload.value,
                  unit: validation.canonicalPayload.unit,
                  sourceOrigin: validation.canonicalPayload.sourceOrigin,
                  effectiveDate: null,
                },
              })
            : null;

          const candidate = await tx.knowledgeCandidate.create({
            data: {
              intakeJobId: job.id,
              extractionArtifactId: artifact.id,
              workspaceId: job.workspaceId,
              organizationId: job.organizationId,
              knowledgeType: 'PRICE_POINT',
              contextPath: JSON.stringify({
                rowNumber: row.rowNumber ?? null,
                rawValues: row.values ?? [],
                detectedColumns,
              }),
              canonicalPricePointId: canonicalPricePoint?.id,
              lifecycleStatus: validation.lifecycleStatus,
              confidence: validation.confidence,
            },
          });

          await tx.validationResult.create({
            data: {
              candidateId: candidate.id,
              status: validation.status,
              confidence: validation.confidence,
              messages: validation.messages,
            },
          });

          candidatesCreated += 1;
        }

        await tx.intakeJob.update({
          where: { id: job.id },
          data: { status: 'NEEDS_REVIEW' },
        });

        return { candidatesCreated };
      });

      return {
        processed: true,
        intakeJobId: job.id,
        status: 'NEEDS_REVIEW',
        candidatesCreated: result.candidatesCreated,
      };
    } catch (error) {
      return this.failJob(
        job,
        'UNDERSTANDING_VALIDATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async claimNextJob(): Promise<UnderstandingJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT id, version
        FROM intake_jobs
        WHERE status = 'UNDERSTANDING'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      const updateResult = await tx.intakeJob.updateMany({
        where: {
          id: row.id,
          version: row.version,
          status: 'UNDERSTANDING',
        },
        data: {
          status: 'VALIDATING',
          claimedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updateResult.count !== 1) {
        return null;
      }

      return tx.intakeJob.findUnique({
        where: { id: row.id },
        include: {
          extractionArtifacts: {
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      });
    });
  }

  private async failJob(
    job: IntakeJob,
    errorCode: string,
    reason: string,
  ): Promise<UnderstandingValidationResult> {
    await this.prisma.intakeJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
      },
    });

    console.error('reality-intake.understanding.failed', {
      correlationId: job.correlationId,
      intakeJobId: job.id,
      workspaceId: job.workspaceId,
      organizationId: job.organizationId,
      errorCode,
      reason,
      stage: 'UNDERSTANDING_VALIDATION',
    });

    return {
      processed: true,
      intakeJobId: job.id,
      status: 'FAILED',
      candidatesCreated: 0,
      errorCode,
    };
  }

  private asRawRows(rawRows: unknown): RawRow[] {
    if (!Array.isArray(rawRows)) {
      throw new Error('ExtractionArtifact.rawRows is not an array');
    }

    return rawRows.map((row) => {
      if (!row || typeof row !== 'object') {
        return { values: [] };
      }

      const rawRow = row as RawRow;
      return {
        rowNumber: rawRow.rowNumber,
        values: Array.isArray(rawRow.values) ? rawRow.values : [],
      };
    });
  }

  private detectColumns(rawRows: RawRow[]): DetectedColumn[] {
    const headerValues = rawRows[0]?.values ?? [];
    const detectedColumns: DetectedColumn[] = [];

    for (let index = 0; index < headerValues.length; index += 1) {
      const normalized = this.normalizeHeader(headerValues[index]);
      if (!normalized) {
        continue;
      }

      for (const role of Object.keys(HEADER_DICTIONARY) as ColumnRole[]) {
        if (HEADER_DICTIONARY[role].includes(normalized)) {
          detectedColumns.push({
            role,
            columnIndex: index + 1,
            headerValue: headerValues[index],
          });
        }
      }
    }

    return detectedColumns;
  }

  private validateRow(row: RawRow, detectedColumns: DetectedColumn[]): RowValidation {
    const ruleOutcomes: string[] = [];
    const ambiguousRoles = this.findAmbiguousRoles(detectedColumns);
    const values = row.values ?? [];
    const resource = this.getCellString(values, detectedColumns, 'resource');
    const unit = this.getCellString(values, detectedColumns, 'unit');
    const priceText = this.getCellString(values, detectedColumns, 'price');
    const sourceOriginText = this.getCellString(
      values,
      detectedColumns,
      'sourceOrigin',
    );

    if (ambiguousRoles.length > 0) {
      ruleOutcomes.push(`AMBIGUOUS_HEADER:${ambiguousRoles.join(',')}`);
      return this.invalidResult('AMBIGUOUS', 0, ruleOutcomes);
    }

    if (!resource) {
      ruleOutcomes.push('MISSING_RESOURCE');
    }
    if (!unit) {
      ruleOutcomes.push('MISSING_UNIT');
    }
    if (!priceText) {
      ruleOutcomes.push('MISSING_PRICE');
    }
    if (!sourceOriginText) {
      ruleOutcomes.push('MISSING_SOURCE_ORIGIN');
    }

    if (ruleOutcomes.length > 0) {
      return this.invalidResult('UNRESOLVED', 0, ruleOutcomes);
    }

    const resolvedResource = resource;
    const resolvedUnit = unit;
    const resolvedPriceText = priceText;
    const resolvedSourceOriginText = sourceOriginText;
    if (
      !resolvedResource ||
      !resolvedUnit ||
      !resolvedPriceText ||
      !resolvedSourceOriginText
    ) {
      return this.invalidResult('UNRESOLVED', 0, ruleOutcomes);
    }

    const price = Number(resolvedPriceText);
    if (!Number.isFinite(price)) {
      ruleOutcomes.push('NON_NUMERIC_PRICE');
      return this.invalidResult('NEEDS_REVIEW', 0, ruleOutcomes);
    }

    if (price < 0) {
      ruleOutcomes.push('NEGATIVE_PRICE');
      return this.invalidResult('NEEDS_REVIEW', 0, ruleOutcomes);
    }

    const sourceOrigin = this.parseSourceOrigin(resolvedSourceOriginText);
    if (!sourceOrigin) {
      ruleOutcomes.push('INVALID_SOURCE_ORIGIN');
      return this.invalidResult('NEEDS_REVIEW', 0, ruleOutcomes);
    }

    ruleOutcomes.push(
      'RESOURCE_PRESENT',
      'UNIT_PRESENT',
      'PRICE_PRESENT',
      'PRICE_NUMERIC',
      'PRICE_NON_NEGATIVE',
      'SOURCE_ORIGIN_VALID',
    );

    return {
      status: 'MATCHED',
      lifecycleStatus: 'VALIDATED',
      confidence: 1,
      messages: JSON.stringify(ruleOutcomes),
      canonicalPayload: {
        resourceRef: resolvedResource,
        value: price,
        unit: resolvedUnit,
        sourceOrigin,
      },
    };
  }

  private invalidResult(
    status: ValidationStatus,
    confidence: number,
    ruleOutcomes: string[],
  ): RowValidation {
    return {
      status,
      lifecycleStatus: 'NEEDS_REVIEW',
      confidence,
      messages: JSON.stringify(ruleOutcomes),
    };
  }

  private getCellString(
    values: unknown[],
    detectedColumns: DetectedColumn[],
    role: ColumnRole,
  ): string | null {
    const column = detectedColumns.find((candidate) => candidate.role === role);
    if (!column) {
      return null;
    }

    const value = values[column.columnIndex - 1];
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return String(value).trim();
  }

  private findAmbiguousRoles(detectedColumns: DetectedColumn[]): ColumnRole[] {
    return (Object.keys(HEADER_DICTIONARY) as ColumnRole[]).filter(
      (role) =>
        detectedColumns.filter((column) => column.role === role).length > 1,
    );
  }

  private normalizeHeader(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return String(value).trim().toLowerCase();
  }

  private parseSourceOrigin(value: string): PriceSourceOrigin | null {
    const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return VALID_SOURCE_ORIGINS.has(normalized)
      ? (normalized as PriceSourceOrigin)
      : null;
  }

  private hasAnyValue(row: RawRow): boolean {
    return (row.values ?? []).some(
      (value) => value !== null && value !== undefined && value !== '',
    );
  }
}
