import { ConflictException } from '@nestjs/common';
import { ProjectAhspService } from './project-ahsp.service';

describe('ProjectAhspService E1A', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  let prisma: any;
  let service: ProjectAhspService;

  beforeEach(() => {
    prisma = {
      aHSPVersion: { findMany: jest.fn().mockResolvedValue([]) },
      region: { findMany: jest.fn().mockResolvedValue([]) },
      projectAhspOccurrence: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new ProjectAhspService(
      prisma,
      { publicEligibilityWhere: jest.fn(() => ({ status: 'PUBLISHED', verificationStatus: 'PUBLISHED' })) } as any,
      { resolve: jest.fn() } as any,
      { evaluateInTransaction: jest.fn() } as any,
    );
  });

  it('Q-01 eligible query is tenant/date/status scoped and rejects SUPERSEDED by exact PUBLISHED predicate', async () => {
    await service.listEligibleVersions(workspaceId, '2026-08-04');
    const where = prisma.aHSPVersion.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PUBLISHED');
    expect(where.effectiveDate.lte).toEqual(new Date('2026-08-04T00:00:00.000Z'));
    expect(JSON.stringify(where)).toContain(workspaceId);
    expect(JSON.stringify(where)).not.toContain('SUPERSEDED');
  });

  it('Q-02 requires a non-null output unit and at least one resource', async () => {
    await service.listEligibleVersions(workspaceId, '2026-08-04');
    expect(prisma.aHSPVersion.findMany.mock.calls[0][0].where).toMatchObject({
      outputUnit: { not: null },
      resources: { some: {} },
    });
  });

  it('region query returns active regions only', async () => {
    await service.listActiveRegions();
    expect(prisma.region.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('S-02 rejects a local-* row deterministically before transaction work', async () => {
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'p', status: 'PLANNED', workspaceId }]),
        projectAhspOccurrence: { findFirst: jest.fn().mockResolvedValue(null) },
        projectBaseline: { count: jest.fn() },
        rabDocument: { count: jest.fn() },
        boqStructure: { count: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 's' }) },
        boqItem: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    );
    (service as any).lifecycle.evaluateInTransaction.mockResolvedValue({ canEditDraft: true });
    await expect(
      service.selectForBoqItem({
        projectId: '10000000-0000-4000-8000-000000000001',
        workspaceId,
        accountId: '30000000-0000-4000-8000-000000000001',
        boqItemId: 'local-1',
        ahspVersionId: '40000000-0000-4000-8000-000000000001',
        businessPricingAsOfDate: '2026-08-04',
        referenceRegionId: '50000000-0000-4000-8000-000000000001',
        idempotencyKey: 'key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('S-03 rejects the same idempotency key with a different request hash', async () => {
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'p', status: 'PLANNED', workspaceId }]),
        projectAhspOccurrence: {
          findFirst: jest.fn().mockResolvedValue({ requestPayloadHash: 'different' }),
        },
      }),
    );
    await expect(
      service.selectForBoqItem({
        projectId: '10000000-0000-4000-8000-000000000001',
        workspaceId,
        accountId: '30000000-0000-4000-8000-000000000001',
        boqItemId: '60000000-0000-4000-8000-000000000001',
        ahspVersionId: '40000000-0000-4000-8000-000000000001',
        businessPricingAsOfDate: '2026-08-04',
        referenceRegionId: '50000000-0000-4000-8000-000000000001',
        idempotencyKey: 'key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findOne is scoped by occurrence, project, and workspace', async () => {
    prisma.projectAhspOccurrence.findFirst.mockResolvedValue({ id: 'o' });
    await service.findOne('o', 'p', 'w');
    expect(prisma.projectAhspOccurrence.findFirst).toHaveBeenCalledWith({
      where: { id: 'o', projectId: 'p', workspaceId: 'w' },
      include: { resourceResolutions: true },
    });
  });
});
