import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
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
        methodType: ahsp.methodType,
        locationType: ahsp.locationType,
        methodName: ahsp.methodName,
        deletedAt: null,
      },
    });
    expect(prisma.aHSP.create).toHaveBeenCalledWith({
      data: {
        workspaceId: undefined,
        workType: ahsp.workType,
        methodType: ahsp.methodType,
        locationType: ahsp.locationType,
        methodName: ahsp.methodName,
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
      include: { versions: true },
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
        'id',
        'locationType',
        'methodName',
        'methodType',
        'ownershipType',
        'reviewStatus',
        'updatedAt',
        'workType',
        'workspaceId',
      ]);
    });

    it('hands back exactly what the database returned', async () => {
      const rows = [{ id: 'ahsp-1', workType: 'Concrete Work' }];
      prisma.aHSP.findMany.mockResolvedValue(rows);
      await expect(service.list('workspace-1')).resolves.toBe(rows);
    });

    it('borrows no part of the RAB binding predicate', async () => {
      prisma.aHSP.findMany.mockResolvedValue([]);
      await service.list('workspace-1');
      const query = JSON.stringify(prisma.aHSP.findMany.mock.calls[0][0]);
      // Bindability requires a priceable version; visibility does not. If any
      // of these appear, discovery has been coupled to selectForBoqItem's
      // security invariant.
      for (const bindingOnly of ['outputUnit', 'effectiveDate', 'expiredDate', 'PUBLISHED']) {
        expect(query).not.toContain(bindingOnly);
      }
    });
  });
});
