import { Prisma } from '@prisma/client';
import {
  BOQ_INTERPRETATION_MODE,
  BOQ_KNOWLEDGE_TYPE,
  IntakeEnqueueService,
  boqInterpretationKeyOf,
} from './intake-enqueue.service';

describe('IntakeEnqueueService atomic cleanup', () => {
  it('deletes the final file when the transaction fails after final move', async () => {
    const finalRef = 'final-storage-ref';
    const storage = {
      writeTemp: jest.fn().mockResolvedValue('temp-file'),
      computeChecksum: jest.fn().mockReturnValue('checksum'),
      moveToFinal: jest.fn().mockResolvedValue(finalRef),
      deleteTemp: jest.fn().mockResolvedValue(undefined),
      deleteFinal: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      intakeJob: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('forced tx failure')),
    };
    const service = new IntakeEnqueueService(prisma as any, storage as any);

    await expect(
      service.enqueueUpload({
        fileName: 'acceptance.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 4,
        bytes: Buffer.from('test'),
        workspaceId: 'workspace-id',
        organizationId: 'organization-id',
        uploadedByAccountId: 'account-id',
      }),
    ).rejects.toThrow('forced tx failure');

    expect(storage.deleteFinal).toHaveBeenCalledWith(finalRef);
    expect(storage.deleteTemp).toHaveBeenCalledWith(null);
  });
});

describe('IntakeEnqueueService BOQ request truth', () => {
  const bytes = Buffer.from('same-boq');
  const source = {
    id: 'source-id',
    workspaceId: 'workspace-id',
    organizationId: 'organization-id',
    uploadedByAccountId: 'first-account-id',
    fileName: 'first.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteSize: bytes.length,
    checksum: 'same-checksum',
    storageRef: 'retained/source',
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
  };

  it('records every requester while reusing retained source content', async () => {
    const createdRequests: Array<Record<string, unknown>> = [];
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'project-id',
          workspaceId: 'workspace-id',
          organizationId: 'organization-id',
        }),
      },
      sourceDocument: { findFirst: jest.fn().mockResolvedValue(source) },
      intakeRequest: {
        create: jest.fn().mockImplementation(({ data }) => {
          createdRequests.push(data);
          return Promise.resolve({
            id: `request-${createdRequests.length}`,
            ...data,
          });
        }),
      },
    };
    const storage = {
      computeChecksum: jest.fn().mockReturnValue('same-checksum'),
      writeTemp: jest.fn(),
      moveToFinal: jest.fn(),
      deleteTemp: jest.fn(),
      deleteFinal: jest.fn(),
    };
    const service = new IntakeEnqueueService(prisma as any, storage as any);
    const common = {
      fileName: 'presented.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: bytes.length,
      bytes,
      workspaceId: 'workspace-id',
      projectId: 'project-id',
    };

    const first = await service.beginBoqIntakeRequest({
      ...common,
      requestingAccountId: 'account-a',
    });
    const second = await service.beginBoqIntakeRequest({
      ...common,
      requestingAccountId: 'account-b',
    });

    expect(first.sourceDocumentId).toBe(source.id);
    expect(second.sourceDocumentId).toBe(source.id);
    expect(createdRequests).toHaveLength(2);
    expect(createdRequests.map((row) => row.requestingAccountId)).toEqual([
      'account-a',
      'account-b',
    ]);
    expect(createdRequests.every((row) => row.intakeJobId == null)).toBe(true);
    expect(storage.writeTemp).not.toHaveBeenCalled();
  });

  it('rechecks canonical source under the transaction lock and deletes the losing file', async () => {
    const finalRef = 'loser/source';
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      sourceDocument: {
        findFirst: jest.fn().mockResolvedValue(source),
        create: jest.fn(),
      },
      intakeRequest: {
        create: jest.fn().mockResolvedValue({ id: 'request-id' }),
      },
    };
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'project-id',
          workspaceId: 'workspace-id',
          organizationId: 'organization-id',
        }),
      },
      sourceDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    };
    const storage = {
      computeChecksum: jest.fn().mockReturnValue(source.checksum),
      writeTemp: jest.fn().mockResolvedValue('temp-file'),
      moveToFinal: jest.fn().mockResolvedValue(finalRef),
      deleteTemp: jest.fn().mockResolvedValue(undefined),
      deleteFinal: jest.fn().mockResolvedValue(undefined),
    };
    const service = new IntakeEnqueueService(prisma as any, storage as any);

    const result = await service.beginBoqIntakeRequest({
      fileName: 'concurrent.xlsx',
      mimeType: source.mimeType,
      byteSize: bytes.length,
      bytes,
      workspaceId: 'workspace-id',
      projectId: 'project-id',
      requestingAccountId: 'account-b',
    });

    expect(result.sourceDocumentId).toBe(source.id);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.sourceDocument.create).not.toHaveBeenCalled();
    expect(tx.intakeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceDocumentId: source.id }),
    });
    expect(storage.deleteFinal).toHaveBeenCalledWith(finalRef);
  });

  it('excludes actor, request, and timestamp from canonical interpretation identity', () => {
    const identity = {
      workspaceId: 'workspace-id',
      organizationId: 'organization-id',
      projectId: 'project-id',
      sourceSha256: 'ABCDEF',
      knowledgeType: BOQ_KNOWLEDGE_TYPE,
      interpretationMode: BOQ_INTERPRETATION_MODE,
      selectedSheet: 'RAB',
      readerContractVersion: 'READER_V1',
      semanticContractVersion: 'BOQ_V1',
    } as const;

    expect(boqInterpretationKeyOf(identity)).toBe(
      boqInterpretationKeyOf({ ...identity, sourceSha256: 'abcdef' }),
    );
    expect(
      boqInterpretationKeyOf({ ...identity, selectedSheet: 'RAB-2' }),
    ).not.toBe(boqInterpretationKeyOf(identity));
    expect(
      boqInterpretationKeyOf({ ...identity, projectId: 'project-2' }),
    ).not.toBe(boqInterpretationKeyOf(identity));
    expect(
      boqInterpretationKeyOf({
        ...identity,
        semanticContractVersion: 'BOQ_V2',
      }),
    ).not.toBe(boqInterpretationKeyOf(identity));
  });

  it('re-reads and binds the database winner after a concurrent unique race', async () => {
    const winner = {
      id: 'job-winner',
      sourceDocumentId: source.id,
      workspaceId: 'workspace-id',
      organizationId: 'organization-id',
      idempotencyKey: 'winner-key',
      interpretationKey: '',
      projectId: 'project-id',
      knowledgeType: BOQ_KNOWLEDGE_TYPE,
      interpretationMode: BOQ_INTERPRETATION_MODE,
      selectedSheet: 'RAB',
      readerContractVersion: 'READER_V1',
      semanticContractVersion: 'BOQ_V1',
      status: 'QUEUED',
      lastCompletedStage: null,
      correlationId: 'job-correlation',
      claimedAt: null,
      attempts: 0,
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceDocument: source,
    };
    winner.interpretationKey = boqInterpretationKeyOf({
      workspaceId: winner.workspaceId,
      organizationId: winner.organizationId,
      projectId: winner.projectId,
      sourceSha256: source.checksum,
      knowledgeType: BOQ_KNOWLEDGE_TYPE,
      interpretationMode: BOQ_INTERPRETATION_MODE,
      selectedSheet: winner.selectedSheet,
      readerContractVersion: winner.readerContractVersion,
      semanticContractVersion: winner.semanticContractVersion,
    });
    const request = {
      id: 'request-id',
      sourceDocumentId: source.id,
      intakeJobId: null,
      requestingAccountId: 'account-b',
      workspaceId: 'workspace-id',
      organizationId: 'organization-id',
      projectId: 'project-id',
      requestedKnowledgeType: BOQ_KNOWLEDGE_TYPE,
      presentedFileName: 'same.xlsx',
      presentedMimeType: source.mimeType,
      correlationId: 'request-correlation',
      createdAt: new Date(),
      sourceDocument: source,
      intakeJob: null,
    };
    const tx = {
      intakeRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      intakeJob: {
        findUnique: jest.fn().mockResolvedValue(winner),
        create: jest.fn(),
      },
    };
    const race = new Prisma.PrismaClientKnownRequestError(
      'unique interpretation race',
      { code: 'P2002', clientVersion: '6.4.1' },
    );
    const prisma = {
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(race)
        .mockImplementationOnce((callback) => callback(tx)),
    };
    const service = new IntakeEnqueueService(prisma as any, {} as any);

    const result = await service.bindBoqInterpretation({
      intakeRequestId: request.id,
      sourceSha256: source.checksum,
      selectedSheet: 'RAB',
      readerContractVersion: 'READER_V1',
      semanticContractVersion: 'BOQ_V1',
    });

    expect(result.intakeJobId).toBe(winner.id);
    expect(tx.intakeJob.create).not.toHaveBeenCalled();
    expect(tx.intakeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: request.id, intakeJobId: null },
      data: { intakeJobId: winner.id },
    });
  });

  it('rejects a canonical job backed by a different source id even when the checksum matches', async () => {
    const otherSource = { ...source, id: 'other-source-id' };
    const request = {
      id: 'request-id',
      sourceDocumentId: source.id,
      intakeJobId: null,
      requestingAccountId: 'account-b',
      workspaceId: 'workspace-id',
      organizationId: 'organization-id',
      projectId: 'project-id',
      requestedKnowledgeType: BOQ_KNOWLEDGE_TYPE,
      presentedFileName: 'same.xlsx',
      presentedMimeType: source.mimeType,
      correlationId: 'request-correlation',
      createdAt: new Date(),
      sourceDocument: source,
      intakeJob: null,
    };
    const interpretationKey = boqInterpretationKeyOf({
      workspaceId: request.workspaceId,
      organizationId: request.organizationId,
      projectId: request.projectId,
      sourceSha256: source.checksum,
      knowledgeType: BOQ_KNOWLEDGE_TYPE,
      interpretationMode: BOQ_INTERPRETATION_MODE,
      selectedSheet: 'RAB',
      readerContractVersion: 'READER_V1',
      semanticContractVersion: 'BOQ_V1',
    });
    const tx = {
      intakeRequest: { findUnique: jest.fn().mockResolvedValue(request) },
      intakeJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-id',
          sourceDocumentId: otherSource.id,
          workspaceId: request.workspaceId,
          organizationId: request.organizationId,
          interpretationKey,
          projectId: request.projectId,
          knowledgeType: BOQ_KNOWLEDGE_TYPE,
          interpretationMode: BOQ_INTERPRETATION_MODE,
          selectedSheet: 'RAB',
          readerContractVersion: 'READER_V1',
          semanticContractVersion: 'BOQ_V1',
          sourceDocument: otherSource,
        }),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    };
    const service = new IntakeEnqueueService(prisma as any, {} as any);

    await expect(
      service.bindBoqInterpretation({
        intakeRequestId: request.id,
        sourceSha256: source.checksum,
        selectedSheet: 'RAB',
        readerContractVersion: 'READER_V1',
        semanticContractVersion: 'BOQ_V1',
      }),
    ).rejects.toThrow('CANONICAL_INTERPRETATION_KEY_COLLISION');
  });
});
