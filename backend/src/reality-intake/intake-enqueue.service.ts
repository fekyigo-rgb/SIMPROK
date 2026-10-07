import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, IntakeJobStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
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

export const BOQ_KNOWLEDGE_TYPE = 'BOQ';
export const BOQ_INTERPRETATION_MODE = 'SELECTED_SHEET';
export const BOQ_INTERPRETATION_KEY_DOMAIN =
  'SIMPROK_BOQ_INTERPRETATION_V1';

export interface BeginBoqIntakeRequestInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  bytes: Buffer;
  workspaceId: string;
  projectId: string;
  requestingAccountId: string;
}

export interface BeginBoqIntakeRequestResult {
  intakeRequestId: string;
  sourceDocumentId: string;
  correlationId: string;
  checksum: string;
}

export interface BindBoqInterpretationInput {
  intakeRequestId: string;
  sourceSha256: string;
  selectedSheet: string;
  readerContractVersion: string;
  semanticContractVersion: string;
}

export interface BindBoqInterpretationResult {
  intakeRequestId: string;
  intakeJobId: string;
  interpretationKey: string;
}

export interface BoqInterpretationIdentity {
  workspaceId: string;
  organizationId: string;
  projectId: string;
  sourceSha256: string;
  knowledgeType: typeof BOQ_KNOWLEDGE_TYPE;
  interpretationMode: typeof BOQ_INTERPRETATION_MODE;
  selectedSheet: string;
  readerContractVersion: string;
  semanticContractVersion: string;
}

export function boqInterpretationKeyOf(
  identity: BoqInterpretationIdentity,
): string {
  const material = JSON.stringify([
    BOQ_INTERPRETATION_KEY_DOMAIN,
    identity.workspaceId,
    identity.organizationId,
    identity.projectId,
    identity.sourceSha256.toUpperCase(),
    identity.knowledgeType,
    identity.interpretationMode,
    identity.selectedSheet,
    identity.readerContractVersion,
    identity.semanticContractVersion,
  ]);

  return createHash('sha256')
    .update(material, 'utf8')
    .digest('hex')
    .toUpperCase();
}

@Injectable()
export class IntakeEnqueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async beginBoqIntakeRequest(
    input: BeginBoqIntakeRequestInput,
  ): Promise<BeginBoqIntakeRequestResult> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: input.projectId,
        workspaceId: input.workspaceId,
      },
      select: {
        id: true,
        workspaceId: true,
        organizationId: true,
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const checksum = this.storage.computeChecksum(input.bytes);
    const correlationId = randomUUID();
    const reusableSource = await this.prisma.sourceDocument.findFirst({
      where: {
        workspaceId: project.workspaceId,
        organizationId: project.organizationId,
        byteSize: input.byteSize,
        checksum: { equals: checksum, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (reusableSource) {
      const request = await this.prisma.intakeRequest.create({
        data: this.requestData(
          input,
          project.organizationId,
          reusableSource.id,
          correlationId,
        ),
      });
      return {
        intakeRequestId: request.id,
        sourceDocumentId: reusableSource.id,
        correlationId,
        checksum: reusableSource.checksum,
      };
    }

    let tempPath: string | null = null;
    let finalStorageRef: string | null = null;
    try {
      tempPath = await this.storage.writeTemp(input.bytes);
      const sourceDocumentId = randomUUID();
      const safeKey = [
        project.workspaceId,
        checksum,
        sourceDocumentId,
        'source',
      ].join('/');
      finalStorageRef = await this.storage.moveToFinal(tempPath, safeKey);
      tempPath = null;

      const created = await this.prisma.$transaction(async (tx) => {
        const sourceDocument = await tx.sourceDocument.create({
          data: {
            id: sourceDocumentId,
            workspaceId: project.workspaceId,
            organizationId: project.organizationId,
            uploadedByAccountId: input.requestingAccountId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            byteSize: input.byteSize,
            checksum,
            storageRef: finalStorageRef!,
          },
        });
        const request = await tx.intakeRequest.create({
          data: this.requestData(
            input,
            project.organizationId,
            sourceDocument.id,
            correlationId,
          ),
        });
        return { sourceDocument, request };
      });

      finalStorageRef = null;
      return {
        intakeRequestId: created.request.id,
        sourceDocumentId: created.sourceDocument.id,
        correlationId,
        checksum: created.sourceDocument.checksum,
      };
    } finally {
      await this.storage.deleteTemp(tempPath);
      await this.storage.deleteFinal(finalStorageRef);
    }
  }

  async bindBoqInterpretation(
    input: BindBoqInterpretationInput,
  ): Promise<BindBoqInterpretationResult> {
    try {
      return await this.prisma.$transaction((tx) =>
        this.bindBoqInterpretationInTransaction(tx, input, true),
      );
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      return this.prisma.$transaction((tx) =>
        this.bindBoqInterpretationInTransaction(tx, input, false),
      );
    }
  }

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

  private requestData(
    input: BeginBoqIntakeRequestInput,
    organizationId: string,
    sourceDocumentId: string,
    correlationId: string,
  ): Prisma.IntakeRequestUncheckedCreateInput {
    return {
      sourceDocumentId,
      requestingAccountId: input.requestingAccountId,
      workspaceId: input.workspaceId,
      organizationId,
      projectId: input.projectId,
      requestedKnowledgeType: BOQ_KNOWLEDGE_TYPE,
      presentedFileName: input.fileName,
      presentedMimeType: input.mimeType,
      correlationId,
    };
  }

  private async bindBoqInterpretationInTransaction(
    tx: Prisma.TransactionClient,
    input: BindBoqInterpretationInput,
    mayCreate: boolean,
  ): Promise<BindBoqInterpretationResult> {
    const request = await tx.intakeRequest.findUnique({
      where: { id: input.intakeRequestId },
      include: {
        sourceDocument: true,
        intakeJob: { include: { sourceDocument: true } },
      },
    });
    if (!request) throw new NotFoundException('Intake request not found');
    if (request.requestedKnowledgeType !== BOQ_KNOWLEDGE_TYPE) {
      throw new ConflictException('INTAKE_REQUEST_KNOWLEDGE_TYPE_MISMATCH');
    }
    if (
      request.sourceDocument.workspaceId !== request.workspaceId ||
      request.sourceDocument.organizationId !== request.organizationId
    ) {
      throw new ConflictException('INTAKE_REQUEST_SOURCE_SCOPE_MISMATCH');
    }
    if (
      request.sourceDocument.checksum.toUpperCase() !==
      input.sourceSha256.toUpperCase()
    ) {
      throw new ConflictException('INTAKE_REQUEST_SOURCE_DIGEST_MISMATCH');
    }

    const identity: BoqInterpretationIdentity = {
      workspaceId: request.workspaceId,
      organizationId: request.organizationId,
      projectId: request.projectId,
      sourceSha256: input.sourceSha256,
      knowledgeType: BOQ_KNOWLEDGE_TYPE,
      interpretationMode: BOQ_INTERPRETATION_MODE,
      selectedSheet: input.selectedSheet,
      readerContractVersion: input.readerContractVersion,
      semanticContractVersion: input.semanticContractVersion,
    };
    const interpretationKey = boqInterpretationKeyOf(identity);

    if (request.intakeJob) {
      this.assertMatchingBoqJob(request.intakeJob, identity, interpretationKey);
      return {
        intakeRequestId: request.id,
        intakeJobId: request.intakeJob.id,
        interpretationKey,
      };
    }

    let intakeJob = await tx.intakeJob.findUnique({
      where: { interpretationKey },
      include: { sourceDocument: true },
    });
    if (!intakeJob && mayCreate) {
      intakeJob = await tx.intakeJob.create({
        data: {
          sourceDocumentId: request.sourceDocumentId,
          workspaceId: request.workspaceId,
          organizationId: request.organizationId,
          idempotencyKey: `BOQ:${interpretationKey}`,
          interpretationKey,
          projectId: request.projectId,
          knowledgeType: BOQ_KNOWLEDGE_TYPE,
          interpretationMode: BOQ_INTERPRETATION_MODE,
          selectedSheet: input.selectedSheet,
          readerContractVersion: input.readerContractVersion,
          semanticContractVersion: input.semanticContractVersion,
          status: 'QUEUED',
          correlationId: randomUUID(),
        },
        include: { sourceDocument: true },
      });
    }
    if (!intakeJob) {
      throw new ConflictException('CANONICAL_INTERPRETATION_RACE_UNRESOLVED');
    }
    this.assertMatchingBoqJob(intakeJob, identity, interpretationKey);

    const bound = await tx.intakeRequest.updateMany({
      where: { id: request.id, intakeJobId: null },
      data: { intakeJobId: intakeJob.id },
    });
    if (bound.count !== 1) {
      const winner = await tx.intakeRequest.findUnique({
        where: { id: request.id },
        include: {
          intakeJob: { include: { sourceDocument: true } },
        },
      });
      if (!winner?.intakeJob) {
        throw new ConflictException('INTAKE_REQUEST_BINDING_RACE_UNRESOLVED');
      }
      this.assertMatchingBoqJob(
        winner.intakeJob,
        identity,
        interpretationKey,
      );
      intakeJob = winner.intakeJob;
    }

    return {
      intakeRequestId: request.id,
      intakeJobId: intakeJob.id,
      interpretationKey,
    };
  }

  private assertMatchingBoqJob(
    job: {
      id: string;
      interpretationKey: string | null;
      workspaceId: string;
      organizationId: string;
      projectId: string | null;
      knowledgeType: string | null;
      interpretationMode: string | null;
      selectedSheet: string | null;
      readerContractVersion: string | null;
      semanticContractVersion: string | null;
      sourceDocument: { checksum: string };
    },
    identity: BoqInterpretationIdentity,
    interpretationKey: string,
  ): void {
    const matches =
      job.interpretationKey === interpretationKey &&
      job.workspaceId === identity.workspaceId &&
      job.organizationId === identity.organizationId &&
      job.projectId === identity.projectId &&
      job.knowledgeType === identity.knowledgeType &&
      job.interpretationMode === identity.interpretationMode &&
      job.selectedSheet === identity.selectedSheet &&
      job.readerContractVersion === identity.readerContractVersion &&
      job.semanticContractVersion === identity.semanticContractVersion &&
      job.sourceDocument.checksum.toUpperCase() ===
        identity.sourceSha256.toUpperCase();
    if (!matches) {
      throw new ConflictException('CANONICAL_INTERPRETATION_KEY_COLLISION');
    }
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
