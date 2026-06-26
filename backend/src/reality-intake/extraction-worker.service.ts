import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IntakeJob, SourceDocument } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { extractXlsxRawRows } from './xlsx-extraction.helper';

type ClaimedJob = IntakeJob & { sourceDocument: SourceDocument };

export type ExtractionProcessResult =
  | { processed: false; reason: 'NO_JOB' }
  | {
      processed: true;
      intakeJobId: string;
      status: 'UNDERSTANDING' | 'FAILED';
      errorCode?: string;
    };

interface ClaimRow {
  id: string;
  version: number;
}

@Injectable()
export class ExtractionWorkerService implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    if (process.env.INTAKE_WORKER_ENABLED !== 'true') {
      return;
    }

    this.interval = setInterval(() => {
      void this.processOnce().catch((error) => {
        console.error('reality-intake.extraction.worker_error', {
          errorCode: 'WORKER_PROCESS_ONCE_FAILED',
          reason: error instanceof Error ? error.message : String(error),
          stage: 'EXTRACTION',
        });
      });
    }, Number(process.env.INTAKE_WORKER_INTERVAL_MS ?? 5000));
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async processOnce(): Promise<ExtractionProcessResult> {
    const job = await this.claimNextJob();
    if (!job) {
      return { processed: false, reason: 'NO_JOB' };
    }

    if (this.isPdf(job.sourceDocument)) {
      return this.failJob(
        job,
        'PDF_EXTRACTION_DEFERRED',
        'PDF extraction is deferred for this slice',
      );
    }

    if (!this.isXlsx(job.sourceDocument)) {
      return this.failJob(
        job,
        'UNSUPPORTED_SOURCE_TYPE',
        'Only XLSX technical extraction is supported in this slice',
      );
    }

    try {
      const bytes = await this.storage.readFinal(job.sourceDocument.storageRef);
      const extraction = await extractXlsxRawRows(bytes);

      await this.prisma.$transaction(async (tx) => {
        const existingArtifact = await tx.extractionArtifact.findFirst({
          where: { intakeJobId: job.id },
          select: { id: true },
        });

        if (!existingArtifact) {
          await tx.extractionArtifact.create({
            data: {
              intakeJobId: job.id,
              rawRows: extraction.rawRows as any,
              detectedColumns: extraction.detectedColumns as any,
              rowCount: extraction.rowCount,
            },
          });
        }

        await tx.intakeJob.update({
          where: { id: job.id },
          data: {
            status: 'UNDERSTANDING',
            lastCompletedStage: 'EXTRACTION',
          },
        });
      });

      return {
        processed: true,
        intakeJobId: job.id,
        status: 'UNDERSTANDING',
      };
    } catch (error) {
      const errorCode = this.isMissingFileError(error)
        ? 'FILE_MISSING'
        : 'XLSX_UNREADABLE';

      return this.failJob(
        job,
        errorCode,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async claimNextJob(): Promise<ClaimedJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT id, version
        FROM intake_jobs
        WHERE status = 'QUEUED'
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
          status: 'QUEUED',
        },
        data: {
          status: 'EXTRACTING',
          claimedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updateResult.count !== 1) {
        return null;
      }

      return tx.intakeJob.findUnique({
        where: { id: row.id },
        include: { sourceDocument: true },
      });
    });
  }

  private async failJob(
    job: ClaimedJob,
    errorCode: string,
    reason: string,
  ): Promise<ExtractionProcessResult> {
    await this.prisma.intakeJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
      },
    });

    console.error('reality-intake.extraction.failed', {
      correlationId: job.correlationId,
      intakeJobId: job.id,
      workspaceId: job.workspaceId,
      organizationId: job.organizationId,
      errorCode,
      reason,
      stage: 'EXTRACTION',
    });

    return {
      processed: true,
      intakeJobId: job.id,
      status: 'FAILED',
      errorCode,
    };
  }

  private isXlsx(sourceDocument: SourceDocument): boolean {
    return (
      sourceDocument.mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      sourceDocument.fileName.toLowerCase().endsWith('.xlsx')
    );
  }

  private isPdf(sourceDocument: SourceDocument): boolean {
    return (
      sourceDocument.mimeType === 'application/pdf' ||
      sourceDocument.fileName.toLowerCase().endsWith('.pdf')
    );
  }

  private isMissingFileError(error: unknown): boolean {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
}
