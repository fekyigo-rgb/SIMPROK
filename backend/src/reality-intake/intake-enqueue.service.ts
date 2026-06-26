import { Injectable } from '@nestjs/common';
import { Prisma, IntakeJobStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

export interface EnqueueUploadInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  bytes: Buffer;
  workspaceId: string;
  organizationId: string;
  uploadedByAccountId: string;
}

export interface EnqueueUploadResult {
  intakeJobId: string;
  sourceDocumentId: string;
  status: IntakeJobStatus;
  checksum: string;
  duplicate: boolean;
}

@Injectable()
export class IntakeEnqueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async enqueueUpload(input: EnqueueUploadInput): Promise<EnqueueUploadResult> {
    let tempPath: string | null = null;
    let finalStorageRef: string | null = null;

    try {
      tempPath = await this.storage.writeTemp(input.bytes);
      const checksum = this.storage.computeChecksum(input.bytes);
      const idempotencyKey = `${checksum}:${input.workspaceId}`;

      const existingJob = await this.findExistingJob(idempotencyKey);
      if (existingJob) {
        await this.storage.deleteTemp(tempPath);
        tempPath = null;
        return this.toDuplicateResult(existingJob, checksum);
      }

      const sourceDocumentId = randomUUID();
      const safeKey = [
        input.workspaceId,
        checksum,
        sourceDocumentId,
        'source',
      ].join('/');
      finalStorageRef = await this.storage.moveToFinal(tempPath, safeKey);
      tempPath = null;

      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const sourceDocument = await tx.sourceDocument.create({
            data: {
              id: sourceDocumentId,
              workspaceId: input.workspaceId,
              organizationId: input.organizationId,
              uploadedByAccountId: input.uploadedByAccountId,
              fileName: input.fileName,
              mimeType: input.mimeType,
              byteSize: input.byteSize,
              checksum,
              storageRef: finalStorageRef!,
            },
          });

          const intakeJob = await tx.intakeJob.create({
            data: {
              sourceDocumentId: sourceDocument.id,
              workspaceId: input.workspaceId,
              organizationId: input.organizationId,
              idempotencyKey,
              status: 'QUEUED',
              correlationId: randomUUID(),
            },
          });

          return { sourceDocument, intakeJob };
        });

        finalStorageRef = null;

        return {
          intakeJobId: created.intakeJob.id,
          sourceDocumentId: created.sourceDocument.id,
          status: created.intakeJob.status,
          checksum,
          duplicate: false,
        };
      } catch (error) {
        await this.storage.deleteFinal(finalStorageRef);
        finalStorageRef = null;

        if (this.isUniqueConstraintError(error)) {
          const duplicate = await this.findExistingJob(idempotencyKey);
          if (duplicate) {
            return this.toDuplicateResult(duplicate, checksum);
          }
        }

        throw error;
      }
    } finally {
      await this.storage.deleteTemp(tempPath);
      await this.storage.deleteFinal(finalStorageRef);
    }
  }

  private async findExistingJob(idempotencyKey: string) {
    return this.prisma.intakeJob.findUnique({
      where: { idempotencyKey },
      include: {
        sourceDocument: true,
      },
    });
  }

  private toDuplicateResult(
    job: NonNullable<Awaited<ReturnType<IntakeEnqueueService['findExistingJob']>>>,
    checksum: string,
  ): EnqueueUploadResult {
    return {
      intakeJobId: job.id,
      sourceDocumentId: job.sourceDocumentId,
      status: job.status,
      checksum: job.sourceDocument.checksum,
      duplicate: true,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
