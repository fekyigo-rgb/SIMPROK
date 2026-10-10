import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  LocationType,
  MethodType,
  OwnershipType,
  Prisma,
  ReviewStatus,
} from '@prisma/client';
import { identicalQuestionKey } from '../../resource-catalog/identical-question-key';
import { neutralQuestionOfHandBuiltLine } from '../../resource-catalog/resource-observation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { AhspSnapshotService } from './ahsp-snapshot.service';
import { AhspService } from './ahsp.service';

describe('AhspService', () => {
  let service: AhspService;
  let prisma: {
    aHSP: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    aHSPVersion: { findFirst: jest.Mock };
    ahspClassificationAssignment: { findMany: jest.Mock };
    user: {
      findUnique: jest.Mock;
    };
    resourceCatalog: { findMany: jest.Mock };
    observedResource: { findMany: jest.Mock };
    unitDefinition: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: {
    logAction: jest.Mock;
  };
  let snapshots: {
    createSnapshot: jest.Mock;
    readProposalSubject: jest.Mock;
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
        updateMany: jest.fn(),
      },
      aHSPVersion: { findFirst: jest.fn() },
      ahspClassificationAssignment: { findMany: jest.fn() },
      user: {
        findUnique: jest.fn(),
      },
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([]) },
      observedResource: { findMany: jest.fn().mockResolvedValue([]) },
      unitDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback) =>
        callback({
          aHSP: {
            update: prisma.aHSP.update,
            updateMany: prisma.aHSP.updateMany,
            findFirst: prisma.aHSP.findFirst,
          },
          aHSPVersion: { findFirst: prisma.aHSPVersion.findFirst },
          ahspClassificationAssignment: {
            findMany: prisma.ahspClassificationAssignment.findMany,
          },
        }),
      ),
    };
    audit = {
      logAction: jest.fn(),
    };
    snapshots = {
      createSnapshot: jest.fn(),
      readProposalSubject: jest.fn(),
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
        {
          provide: AhspSnapshotService,
          useValue: snapshots,
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

    // The pre-check now mirrors the DB @@unique EXACTLY (no deletedAt filter),
    // so a soft-deleted twin — which still holds the unique index — is caught as
    // a clean 409 instead of a raw P2002 / HTTP 500.
    expect(prisma.aHSP.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: null,
        workType: ahsp.workType,
        methodName: ahsp.methodName,
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
        keterangan: null,
        methodType: MethodType.OTHER,
        locationType: LocationType.OTHER,
        createdByUserId: ahsp.createdByUserId,
        ownershipType: 'USER_ASSET',
        reviewStatus: 'PENDING',
      },
    });
    // IMPORT-SEAM-08 — create() now accepts a caller's transaction; with none
    // supplied the audit row is written on the root client, exactly as before.
    expect(audit.logAction).toHaveBeenCalledWith(
      {
        ahspId: ahsp.id,
        action: 'AHSPCreated',
        who: ahsp.createdByUserId,
        after: ahsp,
      },
      undefined,
    );
  });

  it('IMPORT-SEAM-08: create() writes the pre-check, the parent and its audit on a caller-held transaction', async () => {
    const tx = {
      aHSP: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(ahsp),
      },
    };
    await service.create(
      {
        workType: ahsp.workType,
        methodType: ahsp.methodType,
        locationType: ahsp.locationType,
        methodName: ahsp.methodName,
        userId: ahsp.createdByUserId,
      },
      tx as any,
    );
    expect(tx.aHSP.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.aHSP.create).toHaveBeenCalledTimes(1);
    expect(prisma.aHSP.findFirst).not.toHaveBeenCalled();
    expect(prisma.aHSP.create).not.toHaveBeenCalled();
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ ahspId: ahsp.id, action: 'AHSPCreated' }),
      tx,
    );
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

  it('create translates a race-condition Prisma P2002 into a clean 409, never a 500', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(null); // pre-check passes...
    prisma.aHSP.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    await expect(
      service.create({
        workspaceId: 'workspace-1',
        workType: ahsp.workType,
        methodType: MethodType.OTHER,
        locationType: LocationType.OTHER,
        methodName: ahsp.methodName,
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.logAction).not.toHaveBeenCalled();
  });

  it('loadIdentitySurface reads the workspace + Official Repository with canonical current recipe/context', async () => {
    prisma.aHSP.findMany.mockResolvedValue([
      {
        id: 'a1',
        workspaceId: 'workspace-1',
        workType: 'Galian',
        methodName: 'Galian biasa',
        code: 'B.3',
        deletedAt: null,
        classificationAssignments: [
          { leafNodeId: 'leaf-b' },
          { leafNodeId: 'leaf-a' },
        ],
        versions: [
          {
            id: 'ver-2',
            outputUnit: 'm3',
            outputUnitDefinition: { code: 'M3' },
            resources: [
              {
                resourceId: 'resource-1',
                resourceType: 'LABOR',
                baseUnit: 'PERSON_DAY',
                coefficient: { toString: () => '1.250000' },
              },
            ],
          },
        ],
      },
    ]);
    const surface = await service.loadIdentitySurface('workspace-1');
    expect(prisma.aHSP.findMany).toHaveBeenCalledWith({
      where: { OR: [{ workspaceId: 'workspace-1' }, { workspaceId: null }] },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        workspaceId: true,
        workType: true,
        methodName: true,
        code: true,
        deletedAt: true,
        classificationAssignments: {
          where: { isActive: true },
          select: { leafNodeId: true },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: {
            id: true,
            outputUnit: true,
            outputUnitDefinition: { select: { code: true } },
            resources: {
              select: {
                resourceId: true,
                resourceType: true,
                baseUnit: true,
                coefficient: true,
              },
            },
          },
        },
      },
    });
    expect(surface).toEqual([
      {
        ahspId: 'a1',
        workspaceId: 'workspace-1',
        workType: 'Galian',
        methodName: 'Galian biasa',
        code: 'B.3',
        deletedAt: null,
        context: {
          classificationLeafNodeIds: ['leaf-b', 'leaf-a'],
          outputUnitCode: 'M3',
          resources: [
            {
              resourceId: 'resource-1',
              resourceType: 'LABOR',
              baseUnit: 'PERSON_DAY',
              coefficient: '1.250000',
            },
          ],
          versionId: 'ver-2',
        },
      },
    ]);
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

  it('update persists parent keterangan and still drops methodType and classification', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);
    prisma.aHSP.update.mockResolvedValue({ ...ahsp, keterangan: 'catatan lapangan' });
    audit.logAction.mockResolvedValue({ id: 'audit-1' });

    await service.update(
      ahsp.id,
      {
        keterangan: '  catatan lapangan  ',
        methodType: MethodType.CHEMICAL,
        fieldCategory: 'must-not-persist',
      } as any,
      ahsp.createdByUserId,
      'catatan',
      ahsp.workspaceId,
    );

    expect(prisma.aHSP.update).toHaveBeenCalledWith({
      where: { id: ahsp.id },
      data: { keterangan: 'catatan lapangan' },
    });

    prisma.aHSP.update.mockClear();
    await service.update(
      ahsp.id,
      { keterangan: '   ' },
      ahsp.createdByUserId,
      'kosongkan catatan',
      ahsp.workspaceId,
    );
    expect(prisma.aHSP.update).toHaveBeenCalledWith({
      where: { id: ahsp.id },
      data: { keterangan: null },
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
        'classification',
        'classificationAssignments',
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
      expect(select.classificationAssignments.where).toEqual({ isActive: true });
    });

    it('projects assignment paths in the same query and keeps legacy rows readable', async () => {
      prisma.aHSP.findMany.mockResolvedValue([
        {
          id: 'ahsp-assigned',
          workType: 'Concrete Work',
          classification: 'Pekerjaan Konstruksi',
          fieldCategory: 'legacy-kategori',
          classificationAssignments: [
            {
              leafNode: {
                name: 'Beton',
                level: 'JENIS_PEKERJAAN',
                parent: {
                  name: 'Bangunan Gedung',
                  level: 'SUBKATEGORI',
                  parent: {
                    name: 'Cipta Karya',
                    level: 'KATEGORI',
                    parent: { name: 'Pekerjaan Konstruksi', level: 'JENIS_PENGADAAN' },
                  },
                },
              },
            },
          ],
        },
        {
          id: 'ahsp-legacy',
          workType: 'Lama',
          classification: 'Pekerjaan Konstruksi',
          fieldCategory: 'Umum',
        },
      ]);
      const listed = await service.list('workspace-1');
      expect(listed[0]).toMatchObject({
        id: 'ahsp-assigned',
        classificationPaths: [
          {
            jenisPengadaan: 'Pekerjaan Konstruksi',
            kategori: 'Cipta Karya',
            subkategori: 'Bangunan Gedung',
            jenisPekerjaan: 'Beton',
          },
        ],
      });
      expect(listed[0]).not.toHaveProperty('classificationAssignments');
      expect(listed[1]).toMatchObject({
        id: 'ahsp-legacy',
        fieldCategory: 'Umum',
        classificationPaths: [],
      });
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
      prisma.aHSPVersion.findFirst.mockResolvedValue({
        id: 'ver-9',
        versionNumber: 1,
        regulationReference: 'SNI',
        issuerInstitution: 'PUPR',
      });
      prisma.ahspClassificationAssignment.findMany.mockResolvedValue([]);
      snapshots.createSnapshot.mockResolvedValue({
        id: 'snap-1',
        sourceAhspId: ahsp.id,
        sourceVersionId: 'ver-9',
      });
      prisma.aHSP.updateMany.mockResolvedValue({ count: 1 });

      await service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId);

      const data = prisma.aHSP.updateMany.mock.calls[0][0].data;
      expect(data.proposalSnapshotId).toBe('snap-1');
      expect(data.proposedAt).toBeInstanceOf(Date);
      expect(data.proposedByUserId).toBe(ahsp.createdByUserId);
      expect(data.reviewStatus).toBe('PENDING');
      expect(data.reviewStatus).not.toBe('APPROVED');
      expect(data.ownershipType).toBeUndefined();
      expect(data.workspaceId).toBeUndefined();
      expect(audit.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPProposed', ahspId: ahsp.id, ahspVersionId: 'ver-9' }),
        expect.anything(),
      );
    });

    it('refuses a second submission for an already-proposed AHSP', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, proposedAt: new Date() });
      await expect(
        service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.aHSP.updateMany).not.toHaveBeenCalled();
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
      prisma.aHSP.findFirst.mockResolvedValue({
        ...ahsp,
        proposedByUserId: ahsp.createdByUserId,
        proposalSnapshotId: 'snap-1',
      });
      prisma.user.findUnique.mockResolvedValue(reviewer);
      snapshots.readProposalSubject.mockResolvedValue({ sourceVersionId: 'ver-9', snapshotId: 'snap-1' });
      prisma.aHSP.update.mockResolvedValue({ ...ahsp, reviewStatus: 'APPROVED' });
      await service.approve(ahsp.id, 'reviewer-9', ahsp.workspaceId);
      const data = prisma.aHSP.update.mock.calls[0][0].data;
      expect(data.reviewStatus).toBe('APPROVED');
      expect(data.ownershipType).toBeUndefined();
      expect(data.workspaceId).toBeUndefined();
      expect(snapshots.readProposalSubject).toHaveBeenCalledWith('snap-1', ahsp.id, expect.anything());
      expect(audit.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPApproved', ahspVersionId: 'ver-9' }),
        expect.anything(),
      );
    });

    it('reject records the decision as REJECTED and never publishes', async () => {
      prisma.aHSP.findFirst.mockResolvedValue({
        ...ahsp,
        proposedByUserId: ahsp.createdByUserId,
        proposalSnapshotId: 'snap-1',
      });
      snapshots.readProposalSubject.mockResolvedValue({ sourceVersionId: 'ver-9', snapshotId: 'snap-1' });
      prisma.aHSP.update.mockResolvedValue({ ...ahsp, reviewStatus: 'REJECTED' });
      await service.reject(ahsp.id, 'reviewer-9', 'Komponen belum lengkap', ahsp.workspaceId);
      const data = prisma.aHSP.update.mock.calls[0][0].data;
      expect(data.reviewStatus).toBe('REJECTED');
      expect(data.ownershipType).toBeUndefined();
      expect(audit.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPRejected', reason: 'Komponen belum lengkap' }),
        expect.anything(),
      );
    });

    it('propose freezes the highest version and only active assignments of this AHSP', async () => {
      prisma.user.findUnique.mockResolvedValue({ fullName: 'Pemilik', membership: { account: { email: 'owner@simprok.id' } } });
      prisma.aHSP.findFirst.mockResolvedValue({
        ...ahsp,
        code: 'A.1',
        keterangan: 'Catatan',
        ownershipType: 'USER_ASSET',
      });
      prisma.aHSPVersion.findFirst.mockResolvedValue({
        id: 'ver-current',
        versionNumber: 4,
        regulationReference: 'Dasar',
        issuerInstitution: 'Penerbit',
      });
      prisma.ahspClassificationAssignment.findMany.mockResolvedValue([
        { id: 'as-1', leafNodeId: 'leaf-1', provenance: 'HUMAN_ADDED' },
      ]);
      snapshots.createSnapshot.mockResolvedValue({
        id: 'snap-1',
        sourceAhspId: ahsp.id,
        sourceVersionId: 'ver-current',
      });
      prisma.aHSP.updateMany.mockResolvedValue({ count: 1 });

      await service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId);

      expect(prisma.aHSPVersion.findFirst).toHaveBeenCalledWith({
        where: { ahspId: ahsp.id },
        orderBy: { versionNumber: 'desc' },
      });
      expect(prisma.ahspClassificationAssignment.findMany).toHaveBeenCalledWith({
        where: { ahspId: ahsp.id, isActive: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, leafNodeId: true, provenance: true },
      });
      expect(snapshots.createSnapshot).toHaveBeenCalledWith(
        'ver-current',
        ahsp.workspaceId,
        ahsp.createdByUserId,
        expect.objectContaining({
          frozen: {
            code: 'A.1',
            keterangan: 'Catatan',
            regulationReference: 'Dasar',
            issuerInstitution: 'Penerbit',
            ownershipType: 'USER_ASSET',
          },
          activeAssignments: [{ id: 'as-1', leafNodeId: 'leaf-1', provenance: 'HUMAN_ADDED' }],
        }),
      );
    });

    it('a failed snapshot leaves the AHSP unproposed', async () => {
      prisma.user.findUnique.mockResolvedValue({ fullName: 'Pemilik', membership: { account: { email: 'owner@simprok.id' } } });
      prisma.aHSP.findFirst.mockResolvedValue(ahsp);
      prisma.aHSPVersion.findFirst.mockResolvedValue({ id: 'ver-9', versionNumber: 1 });
      prisma.ahspClassificationAssignment.findMany.mockResolvedValue([]);
      snapshots.createSnapshot.mockRejectedValue(new Error('snapshot failed'));

      await expect(
        service.propose(ahsp.id, ahsp.createdByUserId, ahsp.workspaceId),
      ).rejects.toThrow('snapshot failed');
      expect(prisma.aHSP.updateMany).not.toHaveBeenCalled();
      expect(audit.logAction).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AHSPProposed' }),
        expect.anything(),
      );
    });

    it('approve without a proposal subject fails closed and does not write', async () => {
      prisma.user.findUnique.mockResolvedValue(reviewer);
      prisma.aHSP.findFirst.mockResolvedValue({
        ...ahsp,
        proposedByUserId: 'someone-else',
        proposalSnapshotId: null,
      });
      snapshots.readProposalSubject.mockRejectedValue(
        new BadRequestException('AHSP_PROPOSAL_SUBJECT_REQUIRED'),
      );
      await expect(
        service.approve(ahsp.id, 'reviewer-9', ahsp.workspaceId),
      ).rejects.toThrow('AHSP_PROPOSAL_SUBJECT_REQUIRED');
      expect(prisma.aHSP.update).not.toHaveBeenCalled();
    });

    it('forbids the creator from rejecting their own AHSP', async () => {
      prisma.aHSP.findFirst.mockResolvedValue(ahsp);
      await expect(
        service.reject(ahsp.id, ahsp.createdByUserId, 'nope', ahsp.workspaceId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('getDetail attaches unit presentation in one catalog read and leaves stored truth unchanged', async () => {
    const version = {
      id: 'ver-1',
      outputUnit: 'm3',
      outputUnitDefinitionId: 'unit-m3',
      resources: [
        { resourceId: 'Pekerja', resourceType: 'LABOR', baseUnit: 'PERSON_DAY', coefficient: '0.300000' },
        { resourceId: 'Mandor', resourceType: 'LABOR', baseUnit: 'PERSON_MONTH', coefficient: '1.000000' },
        { resourceId: 'Semen', resourceType: 'MATERIAL', baseUnit: 'TONNE', coefficient: '0.050000' },
        { resourceId: 'Kawat', resourceType: 'MATERIAL', baseUnit: 'CENTIMETRE', coefficient: '2.000000' },
        { resourceId: 'Alat', resourceType: 'EQUIPMENT', baseUnit: 'LS', coefficient: '1.000000' },
        { resourceId: 'Lain', resourceType: 'MATERIAL', baseUnit: 'BUKAN-UNIT', coefficient: '3.000000' },
      ],
    };
    prisma.aHSP.findFirst.mockResolvedValue({ ...ahsp, versions: [version] });
    prisma.unitDefinition.findMany.mockResolvedValue([
      { id: 'unit-day', code: 'PERSON_DAY', displayName: 'Orang-hari', symbol: 'orang-hari' },
      { id: 'unit-month', code: 'PERSON_MONTH', displayName: 'Orang-bulan', symbol: 'orang-bulan' },
      { id: 'unit-tonne', code: 'TONNE', displayName: 'Ton metrik', symbol: 't' },
      { id: 'unit-cm', code: 'CENTIMETRE', displayName: 'Sentimeter', symbol: 'cm' },
      { id: 'unit-ls', code: 'LS', displayName: 'Lump sum', symbol: 'ls' },
      { id: 'unit-m3', code: 'M3', displayName: 'Cubic metre', symbol: 'm3' },
    ]);

    const detail = await service.getDetail(ahsp.id, ahsp.workspaceId);

    expect(prisma.unitDefinition.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.unitDefinition.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(JSON.stringify(where)).not.toContain('contains');
    expect(JSON.stringify(where)).not.toContain('mode');
    expect(detail.versions[0].outputUnit).toBe('m3');
    expect(detail.versions[0].outputUnitDefinitionId).toBe('unit-m3');
    expect(detail.versions[0].outputUnitDisplayName).toBe('Cubic metre');
    expect(detail.versions[0].outputUnitSymbol).toBe('m3');
    expect(detail.versions[0].outputUnitCode).toBe('M3');
    expect(detail.versions[0].resources.map((row) => row.baseUnit)).toEqual([
      'PERSON_DAY',
      'PERSON_MONTH',
      'TONNE',
      'CENTIMETRE',
      'LS',
      'BUKAN-UNIT',
    ]);
    expect(detail.versions[0].resources.map((row) => row.coefficient)).toEqual([
      '0.300000',
      '1.000000',
      '0.050000',
      '2.000000',
      '1.000000',
      '3.000000',
    ]);
    expect(detail.versions[0].resources.map((row) => row.unitDisplayName)).toEqual([
      'Orang-hari',
      'Orang-bulan',
      'Ton metrik',
      'Sentimeter',
      'Lump sum',
      null,
    ]);
    expect(detail.versions[0].resources[5].unitSymbol).toBeNull();
    expect(detail.versions[0].resources[5].unitCode).toBeNull();
  });

  it('readProposalSubject reuses the detail unit presentation and leaves stored units unchanged', async () => {
    prisma.aHSP.findFirst.mockResolvedValue({
      ...ahsp,
      proposalSnapshotId: 'snap-1',
      proposedAt: new Date('2026-10-06T10:46:27.761Z'),
      proposedByName: 'Direktur',
      versions: [],
    });
    snapshots.readProposalSubject.mockResolvedValue({
      snapshotId: 'snap-1',
      outputUnit: 'm3',
      outputUnitDefinitionId: 'unit-m3',
      resources: [
        { resourceId: 'Pekerja', baseUnit: 'PERSON_DAY', coefficient: '1' },
        { resourceId: 'Bukti', baseUnit: 'OH', coefficient: '1' },
      ],
      classificationAssignments: [],
    });
    prisma.unitDefinition.findMany.mockResolvedValue([
      { id: 'unit-m3', code: 'M3', displayName: 'Cubic metre', symbol: 'm3' },
      { id: 'unit-day', code: 'PERSON_DAY', displayName: 'Orang-hari', symbol: 'orang-hari' },
    ]);

    const subject = await service.readProposalSubject(ahsp.id, ahsp.workspaceId);

    expect(subject.outputUnit).toBe('m3');
    expect(subject.outputUnitDefinitionId).toBe('unit-m3');
    expect(subject.outputUnitDisplayName).toBe('Cubic metre');
    expect(subject.outputUnitSymbol).toBe('m3');
    expect(subject.outputUnitCode).toBe('M3');
    expect(subject.resources.map((row) => row.baseUnit)).toEqual(['PERSON_DAY', 'OH']);
    expect(subject.resources.map((row) => row.coefficient)).toEqual(['1', '1']);
    expect(subject.resources.map((row) => row.unitDisplayName)).toEqual(['Orang-hari', null]);
    expect(subject.resources[1].unitSymbol).toBeNull();
    expect(subject.resources[1].unitCode).toBeNull();
    const where = prisma.unitDefinition.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(JSON.stringify(where)).not.toContain('contains');
    expect(JSON.stringify(where)).not.toContain('mode');
  });

  it('readProposalSubject shows the catalog name for a stored id and keeps a frozen spelling', async () => {
    const pekerja = '11111111-1111-4111-8111-111111111111';
    const mandor = '22222222-2222-4222-8222-222222222222';
    const semen = '33333333-3333-4333-8333-333333333333';
    const unnamed = '44444444-4444-4444-8444-444444444444';
    prisma.aHSP.findFirst.mockResolvedValue({
      ...ahsp,
      proposalSnapshotId: 'snap-1',
      proposedAt: new Date('2026-10-06T10:46:27.761Z'),
      proposedByName: 'Direktur',
      versions: [],
    });
    snapshots.readProposalSubject.mockResolvedValue({
      snapshotId: 'snap-1',
      outputUnit: 'm3',
      outputUnitDefinitionId: 'unit-m3',
      resources: [
        { resourceId: pekerja, resourceType: 'LABOR', baseUnit: 'PERSON_DAY', coefficient: '1' },
        { resourceId: mandor, resourceType: 'LABOR', baseUnit: 'PERSON_DAY', coefficient: '0.5' },
        { resourceId: semen, resourceType: 'MATERIAL', baseUnit: 'TONNE', coefficient: '1' },
        { resourceId: unnamed, resourceType: 'EQUIPMENT', baseUnit: 'OH', coefficient: '1' },
        { resourceId: 'Pekerja bukti', resourceType: 'LABOR', baseUnit: 'OH', coefficient: '1' },
      ],
    });
    prisma.unitDefinition.findMany.mockResolvedValue([
      { id: 'unit-m3', code: 'M3', displayName: 'Cubic metre', symbol: 'm3' },
      { id: 'unit-day', code: 'PERSON_DAY', displayName: 'Orang-hari', symbol: 'orang-hari' },
      { id: 'unit-tonne', code: 'TONNE', displayName: 'Ton metrik', symbol: 't' },
    ]);
    prisma.resourceCatalog.findMany.mockResolvedValue([
      { id: pekerja, name: 'Pekerja 1' },
      { id: mandor, name: 'MANDOR' },
      { id: semen, name: 'semen' },
    ]);
    const question = neutralQuestionOfHandBuiltLine(ahsp.workspaceId, {
      resourceId: 'Pekerja bukti',
      resourceType: 'LABOR',
      baseUnit: 'OH',
    });
    prisma.observedResource.findMany.mockResolvedValue([
      {
        observationSubjectKey: question ? identicalQuestionKey(question) : 'unused',
        resolvedResourceCatalog: {
          name: 'Nama hidup berubah',
          status: 'ACTIVE',
          workspaceId: ahsp.workspaceId,
        },
      },
    ]);

    const subject = await service.readProposalSubject(ahsp.id, ahsp.workspaceId);

    expect(subject.outputUnit).toBe('m3');
    expect(subject.outputUnitDisplayName).toBe('Cubic metre');
    expect(subject.resources.map((row) => row.resourceId)).toEqual([
      pekerja,
      mandor,
      semen,
      unnamed,
      'Pekerja bukti',
    ]);
    expect(subject.resources.map((row) => row.resourceName)).toEqual([
      'Pekerja 1',
      'MANDOR',
      'semen',
      null,
      null,
    ]);
    expect(subject.resources.map((row) => row.coefficient)).toEqual(['1', '0.5', '1', '1', '1']);
    expect(subject.resources.map((row) => row.baseUnit)).toEqual([
      'PERSON_DAY',
      'PERSON_DAY',
      'TONNE',
      'OH',
      'OH',
    ]);
    expect(subject.resources.map((row) => row.unitDisplayName)).toEqual([
      'Orang-hari',
      'Orang-hari',
      'Ton metrik',
      null,
      null,
    ]);
    expect(prisma.resourceCatalog.update).toBeUndefined();
  });

  it('getDetail does not read the unit catalog for another workspace', async () => {
    prisma.aHSP.findFirst.mockResolvedValue(ahsp);
    await expect(service.getDetail(ahsp.id, 'other-workspace')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.unitDefinition.findMany).not.toHaveBeenCalled();
  });
});
