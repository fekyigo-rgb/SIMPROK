import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  IntakeJob,
  KnowledgeCandidate,
  ValidationResult,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PUBLISHED_BY_REF =
  'SYSTEM_POLICY:STEP-2.5_VALIDATED_KNOWLEDGE_PUBLICATION_v1';

type PublicationJob = IntakeJob & {
  candidates: Array<KnowledgeCandidate & { validationResults: ValidationResult[] }>;
};

interface ClaimRow {
  id: string;
  version: number;
}

export type PublicationResult =
  | { processed: false; reason: 'NO_JOB' }
  | {
      processed: true;
      intakeJobId: string;
      status: 'PUBLISHED' | 'NEEDS_REVIEW' | 'FAILED';
      eventsCreated: number;
      skippedAlreadyPublished: number;
      integrityViolations: number;
      errorCode?: string;
    };

@Injectable()
export class PublicationWorkerService implements OnModuleInit, OnModuleDestroy {
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.INTAKE_PUBLICATION_WORKER_ENABLED !== 'true') {
      return;
    }

    this.interval = setInterval(() => {
      void this.processOnce().catch((error) => {
        console.error('reality-intake.publication.worker_error', {
          errorCode: 'PUBLICATION_PROCESS_ONCE_FAILED',
          reason: error instanceof Error ? error.message : String(error),
          stage: 'PUBLICATION',
        });
      });
    }, Number(process.env.INTAKE_PUBLICATION_WORKER_INTERVAL_MS ?? 5000));
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async processOnce(): Promise<PublicationResult> {
    const job = await this.claimNextJob();
    if (!job) {
      return { processed: false, reason: 'NO_JOB' };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let eventsCreated = 0;
        let skippedAlreadyPublished = 0;
        let integrityViolations = 0;

        for (const candidate of job.candidates) {
          if (candidate.lifecycleStatus !== 'VALIDATED') {
            continue;
          }

          const matchedValidation = candidate.validationResults.find(
            (validation) => validation.status === 'MATCHED',
          );

          const existingEvent = await tx.knowledgeEvent.findFirst({
            where: {
              envelopeId: candidate.id,
              revision: 1,
            },
          });

          if (existingEvent) {
            skippedAlreadyPublished += 1;
            await tx.knowledgeCandidate.update({
              where: { id: candidate.id },
              data: { lifecycleStatus: 'PUBLISHED' },
            });
            console.log('reality-intake.publication.skipped_already_published', {
              intakeJobId: job.id,
              candidateId: candidate.id,
              knowledgeEventId: existingEvent.id,
              stage: 'PUBLICATION',
            });
            continue;
          }

          if (
            candidate.knowledgeType !== 'PRICE_POINT' ||
            !candidate.canonicalPricePointId ||
            !matchedValidation
          ) {
            integrityViolations += 1;
            console.error('reality-intake.publication.integrity_violation', {
              intakeJobId: job.id,
              candidateId: candidate.id,
              canonicalPricePointId: candidate.canonicalPricePointId,
              hasMatchedValidation: Boolean(matchedValidation),
              knowledgeType: candidate.knowledgeType,
              stage: 'PUBLICATION',
            });
            continue;
          }

          await tx.knowledgeEvent.create({
            data: {
              envelopeId: candidate.id,
              knowledgeType: 'PRICE_POINT',
              workspaceId: candidate.workspaceId,
              organizationId: candidate.organizationId,
              canonicalPricePointId: candidate.canonicalPricePointId,
              publishedByRef: PUBLISHED_BY_REF,
              revision: 1,
              provenanceChain: {
                intakeJobId: job.id,
                sourceDocumentId: job.sourceDocumentId,
                extractionArtifactId: candidate.extractionArtifactId,
                candidateId: candidate.id,
                canonicalPricePointId: candidate.canonicalPricePointId,
                validationResultId: matchedValidation.id,
                stage: 'PUBLICATION',
                policy: 'STEP-2.5_FIRST_PUBLICATION',
              },
            },
          });

          await tx.knowledgeCandidate.update({
            where: { id: candidate.id },
            data: {
              lifecycleStatus: 'PUBLISHED',
              version: { increment: 1 },
            },
          });

          eventsCreated += 1;
        }

        const remainingNeedsReview = await tx.knowledgeCandidate.count({
          where: {
            intakeJobId: job.id,
            lifecycleStatus: 'NEEDS_REVIEW',
          },
        });
        const remainingUnpublishedValidated = await tx.knowledgeCandidate.count({
          where: {
            intakeJobId: job.id,
            lifecycleStatus: 'VALIDATED',
          },
        });
        const finalStatus =
          remainingNeedsReview === 0 && remainingUnpublishedValidated === 0
            ? 'PUBLISHED'
            : 'NEEDS_REVIEW';

        await tx.intakeJob.update({
          where: { id: job.id },
          data: {
            status: finalStatus,
            lastCompletedStage:
              finalStatus === 'PUBLISHED'
                ? 'PUBLICATION'
                : eventsCreated > 0 || skippedAlreadyPublished > 0
                  ? 'PARTIAL_PUBLICATION'
                  : job.lastCompletedStage,
          },
        });

        return {
          processed: true,
          intakeJobId: job.id,
          status: finalStatus,
          eventsCreated,
          skippedAlreadyPublished,
          integrityViolations,
        };
      });
    } catch (error) {
      return this.failJob(
        job,
        'PUBLICATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async claimNextJob(): Promise<PublicationJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT j.id, j.version
        FROM intake_jobs j
        WHERE j.status = 'NEEDS_REVIEW'
          AND EXISTS (
            SELECT 1
            FROM knowledge_candidates c
            WHERE c."intakeJobId" = j.id
              AND c."lifecycleStatus" = 'VALIDATED'
              AND NOT EXISTS (
                SELECT 1
                FROM knowledge_events e
                WHERE e."envelopeId" = c.id
                  AND e.revision = 1
              )
          )
        ORDER BY j."createdAt" ASC
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
          status: 'NEEDS_REVIEW',
        },
        data: {
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
          candidates: {
            include: { validationResults: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });
  }

  private async failJob(
    job: IntakeJob,
    errorCode: string,
    reason: string,
  ): Promise<PublicationResult> {
    await this.prisma.intakeJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
      },
    });

    console.error('reality-intake.publication.failed', {
      correlationId: job.correlationId,
      intakeJobId: job.id,
      workspaceId: job.workspaceId,
      organizationId: job.organizationId,
      errorCode,
      reason,
      stage: 'PUBLICATION',
    });

    return {
      processed: true,
      intakeJobId: job.id,
      status: 'FAILED',
      eventsCreated: 0,
      skippedAlreadyPublished: 0,
      integrityViolations: 0,
      errorCode,
    };
  }
}
