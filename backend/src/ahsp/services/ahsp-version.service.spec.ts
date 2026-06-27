import { Test, TestingModule } from '@nestjs/testing';
import {
  AhspVersionStatus,
  LocationType,
  MethodType,
  ResourceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspVersionService } from './ahsp-version.service';

describe('AhspVersionService', () => {
  let service: AhspVersionService;
  let prisma: {
    aHSP: {
      findUnique: jest.Mock;
    };
    aHSPVersion: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
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
  };

  const resource = {
    resourceId: 'resource-1',
    resourceType: ResourceType.MATERIAL,
    coefficient: 1.25,
    baseUnit: 'm3',
    conversionFactor: 1,
  };

  const version = {
    id: 'version-1',
    ahspId: ahsp.id,
    workspaceId: ahsp.workspaceId,
    versionNumber: 1,
    status: AhspVersionStatus.DRAFT,
    resources: [resource],
  };

  beforeEach(async () => {
    prisma = {
      aHSP: {
        findUnique: jest.fn(),
      },
      aHSPVersion: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = {
      logAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspVersionService,
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

    service = module.get<AhspVersionService>(AhspVersionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('createVersion creates the next draft version and writes audit', async () => {
    prisma.aHSP.findUnique.mockResolvedValue(ahsp);
    prisma.aHSPVersion.findFirst.mockResolvedValue({
      ...version,
      versionNumber: 1,
    });
    prisma.aHSPVersion.create.mockResolvedValue({
      ...version,
      versionNumber: 2,
    });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createVersion(ahsp.id, {
        workspaceId: ahsp.workspaceId,
        resources: [resource],
        userId: 'user-1',
        regulationReference: 'SNI-001',
        effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      ...version,
      versionNumber: 2,
    });

    expect(prisma.aHSP.findUnique).toHaveBeenCalledWith({
      where: { id: ahsp.id },
    });
    expect(prisma.aHSPVersion.findFirst).toHaveBeenCalledWith({
      where: { ahspId: ahsp.id },
      orderBy: { versionNumber: 'desc' },
    });
    expect(prisma.aHSPVersion.create).toHaveBeenCalledWith({
      data: {
        ahspId: ahsp.id,
        workspaceId: ahsp.workspaceId,
        versionNumber: 2,
        status: AhspVersionStatus.DRAFT,
        regulationReference: 'SNI-001',
        effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
        resources: {
          create: [
            {
              resourceId: resource.resourceId,
              resourceType: resource.resourceType,
              coefficient: resource.coefficient,
              baseUnit: resource.baseUnit,
              conversionFactor: resource.conversionFactor,
            },
          ],
        },
      },
      include: { resources: true },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: ahsp.id,
      ahspVersionId: version.id,
      action: 'AHSPVersionCreated',
      who: 'user-1',
      after: {
        ...version,
        versionNumber: 2,
      },
    });
  });

  it('updateStatus updates a version status and returns the Prisma result', async () => {
    const updatedVersion = {
      ...version,
      status: AhspVersionStatus.VERIFIED,
    };
    prisma.aHSPVersion.findUnique.mockResolvedValue(version);
    prisma.aHSPVersion.update.mockResolvedValue(updatedVersion);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.updateStatus(
        version.id,
        AhspVersionStatus.VERIFIED,
        'user-1',
        'review complete',
      ),
    ).resolves.toEqual(updatedVersion);

    expect(prisma.aHSPVersion.findUnique).toHaveBeenCalledWith({
      where: { id: version.id },
    });
    expect(prisma.aHSPVersion.update).toHaveBeenCalledWith({
      where: { id: version.id },
      data: { status: AhspVersionStatus.VERIFIED },
    });
    expect(audit.logAction).toHaveBeenCalledWith({
      ahspId: version.ahspId,
      ahspVersionId: version.id,
      action: 'AHSPVersionVERIFIED',
      who: 'user-1',
      before: version,
      after: updatedVersion,
      reason: 'review complete',
    });
  });
});
