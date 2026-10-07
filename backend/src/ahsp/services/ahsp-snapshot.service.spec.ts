import { Test, TestingModule } from '@nestjs/testing';
import { LocationType, MethodType, ResourceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspSnapshotService } from './ahsp-snapshot.service';

describe('AhspSnapshotService', () => {
  let service: AhspSnapshotService;
  let prisma: {
    aHSPVersion: {
      findUnique: jest.Mock;
    };
    aHSPSnapshot: {
      create: jest.Mock;
    };
    ahspSnapshotClassificationAssignment: {
      createMany: jest.Mock;
    };
  };
  let audit: {
    logAction: jest.Mock;
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
    ahspId: 'ahsp-1',
    versionNumber: 3,
    outputUnit: 'M3',
    outputUnitDefinitionId: 'unit-m3',
    ahsp: {
      id: 'ahsp-1',
      workType: 'Concrete Work',
      methodType: MethodType.MANUAL,
      locationType: LocationType.GENERAL,
      methodName: 'Manual concrete mixing',
    },
    resources: [resource],
  };

  const snapshot = {
    id: 'snapshot-1',
    workspaceId: 'workspace-1',
    sourceAhspId: version.ahsp.id,
    sourceVersionId: version.id,
    versionNumber: version.versionNumber,
    resources: [resource],
  };

  beforeEach(async () => {
    prisma = {
      aHSPVersion: {
        findUnique: jest.fn(),
      },
      aHSPSnapshot: {
        create: jest.fn(),
      },
      ahspSnapshotClassificationAssignment: {
        createMany: jest.fn(),
      },
    };
    audit = {
      logAction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AhspSnapshotService,
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

    service = module.get<AhspSnapshotService>(AhspSnapshotService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('createSnapshot creates a snapshot from version data and writes audit', async () => {
    prisma.aHSPVersion.findUnique.mockResolvedValue(version);
    prisma.aHSPSnapshot.create.mockResolvedValue(snapshot);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createSnapshot(version.id, snapshot.workspaceId, 'user-1'),
    ).resolves.toEqual(snapshot);

    expect(prisma.aHSPVersion.findUnique).toHaveBeenCalledWith({
      where: { id: version.id },
      include: { ahsp: true, resources: true },
    });
    expect(prisma.aHSPSnapshot.create).toHaveBeenCalledWith({
      data: {
        workspaceId: snapshot.workspaceId,
        sourceAhspId: version.ahsp.id,
        sourceVersionId: version.id,
        workType: version.ahsp.workType,
        methodType: version.ahsp.methodType,
        locationType: version.ahsp.locationType,
        methodName: version.ahsp.methodName,
        versionNumber: version.versionNumber,
        outputUnit: version.outputUnit,
        outputUnitDefinitionId: version.outputUnitDefinitionId,
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
      ahspId: version.ahspId,
      ahspVersionId: version.id,
      action: 'AHSPSnapshotCreated',
      who: 'user-1',
      after: snapshot,
    });
  });

  it('a proposal freeze copies metadata and only the assignments it is given', async () => {
    prisma.aHSPVersion.findUnique.mockResolvedValue({
      ...version,
      resources: [{ ...resource, coefficient: 1 }],
    });
    prisma.aHSPSnapshot.create.mockResolvedValue(snapshot);
    prisma.ahspSnapshotClassificationAssignment.createMany.mockResolvedValue({ count: 1 });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });
    const client = {
      aHSPVersion: prisma.aHSPVersion,
      aHSPSnapshot: prisma.aHSPSnapshot,
      ahspSnapshotClassificationAssignment: prisma.ahspSnapshotClassificationAssignment,
    };

    await service.createSnapshot(version.id, snapshot.workspaceId, 'user-1', {
      client: client as never,
      frozen: {
        code: 'A.1',
        keterangan: 'Catatan',
        regulationReference: 'Dasar',
        issuerInstitution: 'Penerbit',
        ownershipType: 'USER_ASSET' as never,
      },
      activeAssignments: [{ id: 'as-1', leafNodeId: 'leaf-1', provenance: 'HUMAN_ADDED' as never }],
    });

    expect(prisma.aHSPSnapshot.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        code: 'A.1',
        keterangan: 'Catatan',
        regulationReference: 'Dasar',
        issuerInstitution: 'Penerbit',
        ownershipType: 'USER_ASSET',
        resources: { create: [expect.objectContaining({ coefficient: 1, baseUnit: 'm3' })] },
      }),
    );
    expect(prisma.ahspSnapshotClassificationAssignment.createMany).toHaveBeenCalledWith({
      data: [{
        snapshotId: snapshot.id,
        assignmentId: 'as-1',
        leafNodeId: 'leaf-1',
        provenance: 'HUMAN_ADDED',
      }],
    });
  });

  it('refuses to snapshot an unresolved legacy output unit', async () => {
    prisma.aHSPVersion.findUnique.mockResolvedValue({ ...version, outputUnit: null, outputUnitDefinitionId: null });
    await expect(service.createSnapshot(version.id, snapshot.workspaceId, 'user-1')).rejects.toThrow('AHSP_OUTPUT_UNIT_UNRESOLVED');
    expect(prisma.aHSPSnapshot.create).not.toHaveBeenCalled();
  });
});
