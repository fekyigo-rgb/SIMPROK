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
});
