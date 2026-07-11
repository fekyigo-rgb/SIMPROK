import { BadRequestException } from '@nestjs/common';
import { IntelligenceEvidenceService } from './intelligence-evidence.service';
import { IntelligenceEvidenceRecord } from './constitutional-ai-boundary.service';

describe('IntelligenceEvidenceService', () => {
  const record: IntelligenceEvidenceRecord = {
    requestId: 'req-1',
    workspaceId: '00000000-0000-0000-0000-000000000001',
    organizationId: '00000000-0000-0000-0000-000000000002',
    projectId: '00000000-0000-0000-0000-000000000003',
    accountId: '00000000-0000-0000-0000-000000000004',
    providerIdentifier: 'unconnected-provider',
    modelIdentifier: 'unconnected-model',
    policyVersion: 'P8A-1',
    promptInputHash: 'hash-1',
    status: 'READY',
    sourceReferences: ['project-context:1'],
    toolsRequested: ['READ_PROJECT_CONTEXT'],
    toolsAllowed: ['READ_PROJECT_CONTEXT'],
    toolsDenied: [],
    ahspCandidates: ['00000000-0000-0000-0000-000000000005'],
    selectedAhspIds: ['00000000-0000-0000-0000-000000000005'],
    selectedBasicPriceIds: ['00000000-0000-0000-0000-000000000006'],
    efPermission: 'ALLOWED',
    efReferences: ['ef-1'],
    confidence: [0.7, 0.9],
    reasonCodes: ['MATCHED_WORK_TYPE'],
    policyRejections: [],
    timestamp: '2026-07-11T00:00:00.000Z',
  };

  function createService(options?: { projectFound?: boolean; membershipFound?: boolean }) {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue(options?.projectFound === false ? null : { id: record.projectId }),
      },
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue(options?.membershipFound === false ? null : { id: 'membership-1' }),
      },
      intelligenceEvidence: {
        create: jest.fn().mockResolvedValue({ id: 'evidence-1' }),
      },
    };

    return { service: new IntelligenceEvidenceService(prisma as any), prisma };
  }

  it('writes tenant-scoped READY evidence with normalized arrays', async () => {
    const { service, prisma } = createService();

    await service.append({
      ...record,
      sourceReferences: ['project-context:1', 'project-context:1', ''],
    });

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: record.projectId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith({
      where: {
        accountId: record.accountId,
        workspaceId: record.workspaceId,
      },
      select: { id: true },
    });
    expect(prisma.intelligenceEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: record.requestId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        projectId: record.projectId,
        accountId: record.accountId,
        inputHash: 'hash-1',
        status: 'READY',
        sourceReferences: ['project-context:1'],
        confidence: 0.8,
      }),
    });
  });

  it('writes rejected evidence with reason codes', async () => {
    const { service, prisma } = createService();

    await service.append({
      ...record,
      status: 'REJECTED_BY_POLICY',
      reasonCodes: ['AHSP_NOT_CANONICAL'],
      policyRejections: ['AHSP_NOT_CANONICAL'],
    });

    expect(prisma.intelligenceEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'REJECTED_BY_POLICY',
        reasonCodes: ['AHSP_NOT_CANONICAL'],
        policyRejections: ['AHSP_NOT_CANONICAL'],
      }),
    });
  });

  it('writes provider unavailable evidence', async () => {
    const { service, prisma } = createService();

    await service.append({
      ...record,
      status: 'PROVIDER_UNAVAILABLE',
      confidence: [],
      policyRejections: ['PROVIDER_UNAVAILABLE'],
    });

    expect(prisma.intelligenceEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'PROVIDER_UNAVAILABLE',
        confidence: null,
        policyRejections: ['PROVIDER_UNAVAILABLE'],
      }),
    });
  });

  it('rejects cross-tenant evidence before insert', async () => {
    const { service, prisma } = createService({ projectFound: false });

    await expect(service.append(record)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.intelligenceEvidence.create).not.toHaveBeenCalled();
  });

  it('creates a new row for repeated requestId evaluations', async () => {
    const { service, prisma } = createService();

    await service.append(record);
    await service.append(record);

    expect(prisma.intelligenceEvidence.create).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid confidence before persistence', async () => {
    const { service, prisma } = createService();

    await expect(service.append({ ...record, confidence: [1.1] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.intelligenceEvidence.create).not.toHaveBeenCalled();
  });

  it('exposes no update or delete business path', () => {
    const { service } = createService();

    expect('update' in service).toBe(false);
    expect('delete' in service).toBe(false);
    expect('upsert' in service).toBe(false);
  });
});
