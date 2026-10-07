import { Test, TestingModule } from '@nestjs/testing';
import {
  AhspVersionStatus,
  LocationType,
  MethodType,
  ResourceType,
} from '@prisma/client';
import { buildEligibleAhspVersionWhere } from '../../project-ahsp/ahsp-eligibility.policy';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspSnapshotService } from './ahsp-snapshot.service';

describe('AhspSnapshotService', () => {
  let service: AhspSnapshotService;
  let prisma: {
    aHSPVersion: {
      findFirst: jest.Mock;
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
    workspaceId: 'workspace-1',
    versionNumber: 3,
    status: AhspVersionStatus.DRAFT,
    effectiveDate: null,
    expiredDate: null,
    outputUnit: 'M3',
    outputUnitDefinitionId: 'unit-m3',
    ahsp: {
      id: 'ahsp-1',
      workspaceId: 'workspace-1',
      ownershipType: 'USER_ASSET',
      deletedAt: null,
      archivedAt: null,
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
        findFirst: jest.fn(),
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

  const expectCanonicalEligibilityLookup = (
    ahspVersionId: string,
    workspaceId: string,
  ) => {
    const query = prisma.aHSPVersion.findFirst.mock.calls.at(-1)?.[0];
    const effectiveDateClause = query.where.AND.find(
      (clause: any) =>
        Array.isArray(clause.OR) &&
        clause.OR.some((branch: any) => 'effectiveDate' in branch),
    );
    const asOf = effectiveDateClause.OR.find(
      (branch: any) => branch.effectiveDate !== null,
    ).effectiveDate.lte;

    expect(asOf).toBeInstanceOf(Date);
    expect(query).toEqual({
      where: {
        id: ahspVersionId,
        ...buildEligibleAhspVersionWhere(workspaceId, asOf),
      },
      include: { ahsp: true, resources: true },
    });
  };

  it('allows the workspace to snapshot its own eligible private version', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(version);
    prisma.aHSPSnapshot.create.mockResolvedValue(snapshot);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createSnapshot(version.id, snapshot.workspaceId, 'user-1'),
    ).resolves.toEqual(snapshot);

    expectCanonicalEligibilityLookup(version.id, snapshot.workspaceId);
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

  it('allows a lawful published global catalog version for a workspace', async () => {
    const officialVersion = {
      ...version,
      workspaceId: null,
      status: AhspVersionStatus.PUBLISHED,
      ahsp: {
        ...version.ahsp,
        workspaceId: null,
        ownershipType: 'SIMPROK_ASSET',
      },
    };
    prisma.aHSPVersion.findFirst.mockResolvedValue(officialVersion);
    prisma.aHSPSnapshot.create.mockResolvedValue(snapshot);
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await expect(
      service.createSnapshot(version.id, snapshot.workspaceId, 'user-1'),
    ).resolves.toEqual(snapshot);

    expectCanonicalEligibilityLookup(version.id, snapshot.workspaceId);
    expect(prisma.aHSPSnapshot.create).toHaveBeenCalledTimes(1);
    expect(audit.logAction).toHaveBeenCalledTimes(1);
  });

  it('denies a foreign private version before snapshot, resource, assignment, or audit writes', async () => {
    // The canonical eligibility WHERE makes a foreign private row invisible,
    // so Prisma returns null even when the caller knows its version id.
    prisma.aHSPVersion.findFirst.mockResolvedValue(null);

    await expect(
      service.createSnapshot('foreign-version', snapshot.workspaceId, 'user-1'),
    ).rejects.toThrow('AHSP Version not found');

    expectCanonicalEligibilityLookup('foreign-version', snapshot.workspaceId);
    expect(prisma.aHSPSnapshot.create).not.toHaveBeenCalled();
    expect(
      prisma.ahspSnapshotClassificationAssignment.createMany,
    ).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('preserves not-found behavior for a missing source version', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue(null);

    await expect(
      service.createSnapshot('missing-version', snapshot.workspaceId, 'user-1'),
    ).rejects.toThrow('AHSP Version not found');

    expect(prisma.aHSPSnapshot.create).not.toHaveBeenCalled();
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('keeps a lawful historical catalog version snapshotable without applying new-use currentness', async () => {
    const historicalVersion = {
      ...version,
      workspaceId: null,
      versionNumber: 1,
      status: AhspVersionStatus.PUBLISHED,
      ahsp: {
        ...version.ahsp,
        workspaceId: null,
        ownershipType: 'SIMPROK_ASSET',
      },
    };
    prisma.aHSPVersion.findFirst.mockResolvedValue(historicalVersion);
    prisma.aHSPSnapshot.create.mockResolvedValue({
      ...snapshot,
      versionNumber: historicalVersion.versionNumber,
    });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await service.createSnapshot(
      historicalVersion.id,
      snapshot.workspaceId,
      'user-1',
    );

    expectCanonicalEligibilityLookup(
      historicalVersion.id,
      snapshot.workspaceId,
    );
    expect(prisma.aHSPSnapshot.create.mock.calls[0][0].data.versionNumber).toBe(
      1,
    );
  });

  it('a proposal freeze copies metadata and only the assignments it is given', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue({
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

    expectCanonicalEligibilityLookup(version.id, snapshot.workspaceId);
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
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        ahspId: version.ahspId,
        ahspVersionId: version.id,
        action: 'AHSPSnapshotCreated',
        who: 'user-1',
      }),
      client,
    );
  });

  it('refuses to snapshot an unresolved legacy output unit', async () => {
    prisma.aHSPVersion.findFirst.mockResolvedValue({ ...version, outputUnit: null, outputUnitDefinitionId: null });
    await expect(service.createSnapshot(version.id, snapshot.workspaceId, 'user-1')).rejects.toThrow('AHSP_OUTPUT_UNIT_UNRESOLVED');
    expect(prisma.aHSPSnapshot.create).not.toHaveBeenCalled();
  });
});
