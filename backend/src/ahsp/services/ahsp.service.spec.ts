import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  LocationType,
  MethodType,
  OwnershipType,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspService } from './ahsp.service';

describe('AhspService', () => {
  let service: AhspService;
  let prisma: {
    aHSP: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: {
    logAction: jest.Mock;
  };

  const ahsp = {
    id: 'ahsp-1',
    workspaceId: 'workspace-1',
    workType: 'Concrete Work',
    methodType: MethodType.MANUAL,
    locationType: LocationType.GENERAL,
    methodName: 'Manual concrete mixing',
    createdByUserId: 'user-1',
    ownershipType: OwnershipType.USER_ASSET,
    reviewStatus: ReviewStatus.PENDING,
    archivedAt: null,
    deletedAt: null,
    versions: [],
  };

  beforeEach(async () => {
    prisma = {
      aHSP: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((callback) =>
        callback({
          aHSP: {
            update: prisma.aHSP.update,
          },
        }),
      ),
    };
    audit = {
      logAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AhspAuditService,
          useValue: audit,
        },
      ],
    }).compile();

    service = module.get<AhspService>(AhspService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create checks duplicate official AHSP, creates AHSP, writes audit, and returns the Prisma result', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(null);
    prisma.aHSP.create.mockResolvedValue(ahsp);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.create({
        workType: ahsp.workType,
        methodType: ahsp.methodType,
        locationType: ahsp.locationType,
        methodName: ahsp.methodName,
        userId: ahsp.createdByUserId,
      }),
    ).resolves.toEqual(ahsp);

    expect(prisma.aHSP.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: null,
        workType: ahsp.workType,
        methodName: ahsp.methodName,
        deletedAt: null,
      },
    });
    expect(prisma.aHSP.create).toHaveBeenCalledWith({
      data: {
        workspaceId: undefined,
        workType: ahsp.workType,
        methodName: ahsp.methodName,
        code: null,
        fieldCategory: null,
        subCategory: null,
        classification: null,
        methodType: MethodType.OTHER,
        locationType: LocationType.OTHER,
        createdByUserId: ahsp.createdByUserId,
        ownershipType: 'USER_ASSET',
        reviewStatus: 'PENDING',
      },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: ahsp.id,
      action: 'AHSPCreated',
      who: ahsp.createdByUserId,
      after: ahsp,
    });
  });

  it('create throws ConflictException when official AHSP already exists', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);

    await expect(
      service.create({
        workType: ahsp.workType,
        methodType: ahsp.methodType,
        locationType: ahsp.locationType,
        methodName: ahsp.methodName,
        userId: ahsp.createdByUserId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.aHSP.create).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('create does not treat caller methodType or locationType as parent identity', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(null);
    prisma.aHSP.create.mockResolvedValue({
      ...ahsp,
      methodType: MethodType.OTHER,
      locationType: LocationType.OTHER,
    });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await service.create({
      workspaceId: ahsp.workspaceId,
      workType: ahsp.workType,
      methodType: MethodType.MECHANICAL,
      locationType: LocationType.MOUNTAIN,
      methodName: ahsp.methodName,
      userId: ahsp.createdByUserId,
    });

    expect(prisma.aHSP.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: ahsp.workspaceId,
        workType: ahsp.workType,
        methodName: ahsp.methodName,
        deletedAt: null,
      },
    });
    expect(prisma.aHSP.create.mock.calls[0][0].data.methodType).toBe(MethodType.OTHER);
    expect(prisma.aHSP.create.mock.calls[0][0].data.locationType).toBe(LocationType.OTHER);
    expect(JSON.stringify(prisma.aHSP.findFirst.mock.calls[0][0].where)).not.toContain('MECHANICAL');
    expect(JSON.stringify(prisma.aHSP.findFirst.mock.calls[0][0].where)).not.toContain('MOUNTAIN');
  });

  it('create refuses a second parent that differs only by method or location classification', async () => {
    prisma.aHSP.findFirst.mockResolvedValue({
      ...ahsp,
      methodType: MethodType.MANUAL,
      locationType: LocationType.GENERAL,
    });

    await expect(
      service.create({
        workspaceId: ahsp.workspaceId,
        workType: ahsp.workType,
        methodType: MethodType.SEMI_MECHANICAL,
        locationType: LocationType.COASTAL,
        methodName: ahsp.methodName,
        userId: ahsp.createdByUserId,
      }),
    ).rejects.toMatchObject({ message: 'AHSP_SOURCE_IDENTITY_EXISTS' });

    expect(prisma.aHSP.create).not.toHaveBeenCalled();
  });

  it('getById returns an AHSP scoped to the requested workspace', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);

    await expect(service.getById(ahsp.id, ahsp.workspaceId)).resolves.toEqual(
      ahsp,
    );

    expect(prisma.aHSP.findFirst).toHaveBeenCalledWith({
      where: {
        id: ahsp.id,
        deletedAt: null,
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: { resources: true },
        },
      },
    });
  });

  it('getById throws NotFoundException when AHSP is outside the requested workspace', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);

    await expect(
      service.getById(ahsp.id, 'other-workspace'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update runs inside Prisma transaction, writes audit, and returns the updated AHSP', async () => {
    const updatedAhsp = {
      ...ahsp,
      methodName: 'Updated method',
    };
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);
    prisma.aHSP.update.mockResolvedValue(updatedAhsp);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.update(
        ahsp.id,
        { methodName: updatedAhsp.methodName },
        ahsp.createdByUserId,
        'correct method name',
        ahsp.workspaceId,
      ),
    ).resolves.toEqual(updatedAhsp);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.aHSP.update).toHaveBeenCalledWith({
      where: { id: ahsp.id },
      data: {
        methodName: updatedAhsp.methodName,
      },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: ahsp.id,
      action: 'AHSPUpdated',
      who: ahsp.createdByUserId,
      before: ahsp,
      after: updatedAhsp,
      reason: 'correct method name',
    });
  });

  it('update cannot rewrite parent identity through methodType or locationType', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);
    prisma.aHSP.update.mockResolvedValue(ahsp);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await service.update(
      ahsp.id,
      {
        methodName: 'Updated method',
        methodType: MethodType.CHEMICAL,
        locationType: LocationType.OFFSHORE,
      },
      ahsp.createdByUserId,
      'reclassify',
      ahsp.workspaceId,
    );

    expect(prisma.aHSP.update).toHaveBeenCalledWith({
      where: { id: ahsp.id },
      data: {
        methodName: 'Updated method',
      },
    });
    const persisted = prisma.aHSP.update.mock.calls[0][0].data;
    expect(persisted).not.toHaveProperty('methodType');
    expect(persisted).not.toHaveProperty('locationType');
  });

  it('update persists only source-name identity fields from a raw HTTP body', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);
    prisma.aHSP.update.mockResolvedValue(ahsp);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await service.update(
      ahsp.id,
      {
        methodName: 'Updated method',
        methodType: MethodType.CHEMICAL,
        locationType: LocationType.OFFSHORE,
        reason: 'reclassify',
        userId: 'forged-actor',
      } as any,
      ahsp.createdByUserId,
      'reclassify',
      ahsp.workspaceId,
    );

    expect(prisma.aHSP.update).toHaveBeenCalledWith({
      where: { id: ahsp.id },
      data: {
        methodName: 'Updated method',
      },
    });
    expect(Object.keys(prisma.aHSP.update.mock.calls[0][0].data).sort()).toEqual([
      'methodName',
    ]);
  });
  /**
   * WORKSPACE AHSP DISCOVERY — visibility, not bindability.
   *
   * The room this feeds is the standalone AHSP door. It must show a workspace
   * everything it may see and nothing belonging to anyone else, and it must not
   * borrow the RAB binding predicate to decide that.
   */
  describe('list', () => {
    it('asks for exactly the rows getById would already allow', async () => {
      prisma.aHSP.findMany.mockResolvedValue([]);
      await service.list('workspace-1');
      const where = prisma.aHSP.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        deletedAt: null,
        OR: [{ workspaceId: 'workspace-1' }, { workspaceId: null }],
      });
    });

    it('never reads AHSP belonging to another tenant', async () => {
      prisma.aHSP.findMany.mockResolvedValue([]);
      await service.list('workspace-1');
      const where = prisma.aHSP.findMany.mock.calls[0][0].where;
      // The ONLY non-null workspace the query may name is the caller's. A
      // second workspace id appearing here is a cross-tenant read.
      const named = JSON.stringify(where).match(/workspace-[a-z0-9]+/g) ?? [];
      expect([...new Set(named)]).toEqual(['workspace-1']);
      // NULL is the Official Repository, not a wildcard: it is a literal, and it
      // is the same literal getById accepts.
      expect(JSON.stringify(where)).toContain('"workspaceId":null');
    });

    it('returns stored columns only — nothing derived', async () => {
      prisma.aHSP.findMany.mockResolvedValue([]);
      await service.list('workspace-1');
      const select = prisma.aHSP.findMany.mock.calls[0][0].select;
      expect(select._count).toEqual({ select: { versions: true } });
      expect(Object.keys(select).sort()).toEqual([
        '_count',
        'archivedAt',
        'classification',
        'code',
        'fieldCategory',
        'id',
        'locationType',
        'methodName',
        'methodType',
        'ownershipType',
        'proposedAt',
        'reviewStatus',
        'subCategory',
        'updatedAt',
        'versions',
        'workType',
        'workspaceId',
      ]);
    });

    it('hands back exactly what the database returned', async () => {
      const rows = [{ id: 'ahsp-1', workType: 'Concrete Work' }];
      prisma.aHSP.findMany.mockResolvedValue(rows);
      await expect(service.list('workspace-1')).resolves.toBe(rows);
    });

    it('shows the applicable Satuan/Dasar for display without borrowing the RAB binding predicate', async () => {
      prisma.aHSP.findMany.mockResolvedValue([]);
      await service.list('workspace-1');
      const call = prisma.aHSP.findMany.mock.calls[0][0];
      // Satuan and Dasar are shown from the newest version — DISPLAY only: take
      // the single newest version and read just its output unit and regulation
      // reference. There is no where-filter to a priceable version, so discovery
      // still returns every AHSP the caller may see (including half-composed
      // ones), never selectForBoqItem's narrowed, security-bearing set.
      expect(call.select.versions).toEqual({
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: { outputUnit: true, regulationReference: true },
      });
      expect(call.select.versions.where).toBeUndefined();
      // The binding predicate's date/status invariants never appear anywhere,
      // and the WHERE clause stays pure visibility — no version pricing filter.
      const query = JSON.stringify(call);
      for (const bindingOnly of ['effectiveDate', 'expiredDate', 'PUBLISHED']) {
        expect(query).not.toContain(bindingOnly);
      }
      expect(JSON.stringify(call.where)).not.toContain('outputUnit');
    });
  });

  describe('propose / reject — the Usulkan ke SIMPROK lifecycle', () => {
    const reviewer = { fullName: 'Reviewer Satu', membership: { account: { email: 'reviewer@simprok.id' } } };

    it('propose records the submission and keeps it PENDING — never auto-publishes', async () => {
      prisma.aHSP.findFirst.mockResolvedValue(ahsp);
      prisma.user.findUnique.mockResolvedValue({ fullName: 'Pemilik', membership: { account: { email: 'owner@simprok.id' } } });
      prisma.aHSP.update.mockResolvedValue({ ...ahsp, proposedAt: new Date() });

      await service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId);

      const data = prisma.aHSP.update.mock.calls[0][0].data;
      expect(data.proposedAt).toBeInstanceOf(Date);
      expect(data.proposedByUserId).toBe(ahsp.createdByUserId);
      expect(data.reviewStatus).toBe('PENDING');
      // No auto-publish: proposing never approves nor changes ownership.
      expect(data.reviewStatus).not.toBe('APPROVED');
      expect(data.ownershipType).toBeUndefined();
      expect(audit.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPProposed', ahspId: ahsp.id }),
      );
    });

    it('refuses a second submission for an already-proposed AHSP', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, proposedAt: new Date() });
      await expect(
        service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.aHSP.update).not.toHaveBeenCalled();
    });

    it('refuses to propose an AHSP that is not the workspace owner own asset', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, ownershipType: 'SIMPROK_ASSET' });
      await expect(
        service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids the creator from approving their own AHSP (no self-decision)', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, proposedByUserId: ahsp.createdByUserId });
      await expect(
        service.approve(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.aHSP.update).not.toHaveBeenCalled();
    });

    it('lets a different reviewer approve — recorded, still a human decision', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, proposedByUserId: ahsp.createdByUserId });
      prisma.user.findUnique.mockResolvedValue(reviewer);
      prisma.aHSP.update.mockResolvedValue({ ...ahsp, reviewStatus: 'APPROVED' });
      await service.approve(ahsp.id, 'reviewer-9', ahsp.workspaceId);
      expect(prisma.aHSP.update.mock.calls[0][0].data.reviewStatus).toBe('APPROVED');
      expect(audit.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPApproved' }),
      );
    });

    it('reject records the decision as REJECTED and never publishes', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, proposedByUserId: ahsp.createdByUserId });
      prisma.aHSP.update.mockResolvedValue({ ...ahsp, reviewStatus: 'REJECTED' });
      await service.reject(ahsp.id, 'reviewer-9', 'Komponen belum lengkap', ahsp.workspaceId);
      const data = prisma.aHSP.update.mock.calls[0][0].data;
      expect(data.reviewStatus).toBe('REJECTED');
      expect(data.ownershipType).toBeUndefined();
      expect(audit.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPRejected', reason: 'Komponen belum lengkap' }),
      );
    });

    it('forbids the creator from rejecting their own AHSP', async () => {
      prisma.aHSP.findFirst.mockResolvedValue(ahsp);
      await expect(
        service.reject(ahsp.id, ahsp.createdByUserId, 'nope', ahsp.workspaceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
