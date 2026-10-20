import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ConstructionClassificationLevel,
  Prisma,
  RegionAdministrativeLevel,
} from '@prisma/client';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';

const ROOT = '11111111-1111-4111-8111-111111111111';
const OTHER_ROOT = '22222222-2222-4222-8222-222222222222';
const KATEGORI_A = '33333333-3333-4333-8333-333333333333';
const KATEGORI_B = '44444444-4444-4444-8444-444444444444';
const SUBKATEGORI = '55555555-5555-4555-8555-555555555555';
const JENIS = '66666666-6666-4666-8666-666666666666';
const COUNTRY = '77777777-7777-4777-8777-777777777777';
const OTHER_COUNTRY = '88888888-8888-4888-8888-888888888888';
const PROVINCE_A = '99999999-9999-4999-8999-999999999999';
const PROVINCE_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function classificationNode(
  id: string,
  level: ConstructionClassificationLevel,
  parentId: string | null,
) {
  return {
    id,
    level,
    name: id,
    normalizedName: id,
    code: null,
    parentId,
    workspaceId: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function lineage(
  nodeId: string,
  level: ConstructionClassificationLevel,
  rootId: string,
) {
  const root = classificationNode(
    rootId,
    ConstructionClassificationLevel.JENIS_PENGADAAN,
    null,
  );
  const node =
    level === ConstructionClassificationLevel.JENIS_PENGADAAN
      ? root
      : classificationNode(nodeId, level, rootId);
  return {
    node,
    ancestors: node.id === root.id ? [] : [root],
    path: node.id === root.id ? [root] : [root, node],
  };
}

function createHarness() {
  const tx = {
    project: {
      create: jest.fn().mockResolvedValue({ id: 'project-1' }),
    },
    workspaceMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    projectAssignment: {
      create: jest.fn(),
    },
    boqStructure: {
      create: jest.fn().mockResolvedValue({ id: 'draft-1' }),
    },
    projectClassificationSelection: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    projectRegionSelection: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  let committed = false;
  const classification = {
    getLineage: jest.fn(),
    listVisibleRoots: jest.fn(),
    listChildren: jest.fn(),
  };
  const prisma = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    },
    region: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      committed = true;
      return result;
    }),
  };
  const service = new ProjectService(
    prisma as any,
    {} as any,
    {} as any,
    undefined,
    undefined,
    classification as any,
  );
  return {
    service,
    prisma,
    tx,
    classification,
    committed: () => committed,
  };
}

describe('RI-01B project canonical context', () => {
  it('accepts uuid identity arrays and rejects label strings', async () => {
    const accepted = plainToInstance(CreateProjectDto, {
      name: 'Project',
      code: 'RI01B',
      classificationNodeIds: [ROOT, KATEGORI_A],
      locationRegionIds: [PROVINCE_A],
    });
    await expect(validate(accepted)).resolves.toHaveLength(0);

    const rejected = plainToInstance(CreateProjectDto, {
      name: 'Project',
      code: 'RI01B',
      classificationNodeIds: ['Bina Marga'],
      locationRegionIds: ['Maluku'],
    });
    await expect(validate(rejected)).resolves.not.toHaveLength(0);
  });

  it('persists one Jenis Pengadaan root with multiple Kategori and Subkategori ids', async () => {
    const { service, tx, classification } = createHarness();
    classification.getLineage.mockImplementation(async ({ id }: { id: string }) => {
      if (id === ROOT) {
        return lineage(ROOT, ConstructionClassificationLevel.JENIS_PENGADAAN, ROOT);
      }
      if (id === SUBKATEGORI) {
        return lineage(SUBKATEGORI, ConstructionClassificationLevel.SUBKATEGORI, ROOT);
      }
      return lineage(id, ConstructionClassificationLevel.KATEGORI, ROOT);
    });

    await service.create(
      {
        name: 'Project',
        code: 'RI01B',
        classificationNodeIds: [ROOT, KATEGORI_A, KATEGORI_B, SUBKATEGORI],
      },
      'workspace-1',
    );

    expect(classification.getLineage).toHaveBeenCalledWith({
      id: KATEGORI_A,
      workspaceId: 'workspace-1',
    });
    expect(tx.projectClassificationSelection.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: 'project-1', classificationNodeId: ROOT },
        { projectId: 'project-1', classificationNodeId: KATEGORI_A },
        { projectId: 'project-1', classificationNodeId: KATEGORI_B },
        { projectId: 'project-1', classificationNodeId: SUBKATEGORI },
      ],
    });
    expect(tx.boqStructure.create).toHaveBeenCalled();
  });

  it('rejects JENIS_PEKERJAAN before any project row is written', async () => {
    const { service, tx, classification, committed } = createHarness();
    classification.getLineage.mockResolvedValue(
      lineage(JENIS, ConstructionClassificationLevel.JENIS_PEKERJAAN, ROOT),
    );

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          classificationNodeIds: [JENIS],
        },
        'workspace-1',
      ),
    ).rejects.toMatchObject({
      message: 'PROJECT_CLASSIFICATION_LEVEL_FORBIDDEN',
    });
    expect(tx.project.create).not.toHaveBeenCalled();
    expect(committed()).toBe(false);
  });

  it('rejects selections that resolve to more than one Jenis Pengadaan root', async () => {
    const { service, tx, classification } = createHarness();
    classification.getLineage.mockImplementation(async ({ id }: { id: string }) =>
      lineage(
        id,
        ConstructionClassificationLevel.KATEGORI,
        id === KATEGORI_B ? OTHER_ROOT : ROOT,
      ),
    );

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          classificationNodeIds: [KATEGORI_A, KATEGORI_B],
        },
        'workspace-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          classificationNodeIds: [KATEGORI_A, KATEGORI_B],
        },
        'workspace-1',
      ),
    ).rejects.toMatchObject({ message: 'PROJECT_CLASSIFICATION_MULTIPLE_ROOTS' });
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('respects workspace visibility by delegating to ConstructionClassificationService', async () => {
    const { service, tx, classification } = createHarness();
    classification.getLineage.mockRejectedValue(
      new NotFoundException('CLASSIFICATION_NODE_NOT_FOUND'),
    );

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          classificationNodeIds: [KATEGORI_A],
        },
        'workspace-b',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(classification.getLineage).toHaveBeenCalledWith({
      id: KATEGORI_A,
      workspaceId: 'workspace-b',
    });
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('persists multiple provinces under one country and does not invent the country row', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.region.findMany.mockResolvedValue([
      {
        id: PROVINCE_A,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.PROVINCE,
        parentId: COUNTRY,
      },
      {
        id: PROVINCE_B,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.PROVINCE,
        parentId: COUNTRY,
      },
    ]);
    prisma.region.findUnique.mockResolvedValue({
      id: COUNTRY,
      administrativeLevel: RegionAdministrativeLevel.COUNTRY,
      parentId: null,
    });

    await service.create(
      {
        name: 'Project',
        code: 'RI01B',
        locationRegionIds: [PROVINCE_A, PROVINCE_B],
      },
      'workspace-1',
    );

    expect(tx.projectRegionSelection.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: 'project-1', regionId: PROVINCE_A },
        { projectId: 'project-1', regionId: PROVINCE_B },
      ],
    });
  });

  it('rejects an inactive region and a missing region', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.region.findMany.mockResolvedValueOnce([
      {
        id: PROVINCE_A,
        isActive: false,
        administrativeLevel: RegionAdministrativeLevel.PROVINCE,
        parentId: COUNTRY,
      },
    ]);

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          locationRegionIds: [PROVINCE_A],
        },
        'workspace-1',
      ),
    ).rejects.toMatchObject({ message: 'PROJECT_REGION_INACTIVE' });

    prisma.region.findMany.mockResolvedValueOnce([]);
    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          locationRegionIds: [PROVINCE_B],
        },
        'workspace-1',
      ),
    ).rejects.toMatchObject({ message: 'PROJECT_REGION_NOT_FOUND' });
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('rejects another country when one country is explicitly selected', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.region.findMany.mockResolvedValue([
      {
        id: COUNTRY,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.COUNTRY,
        parentId: null,
      },
      {
        id: PROVINCE_B,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.PROVINCE,
        parentId: OTHER_COUNTRY,
      },
    ]);
    prisma.region.findUnique.mockResolvedValue({
      id: OTHER_COUNTRY,
      administrativeLevel: RegionAdministrativeLevel.COUNTRY,
      parentId: null,
    });

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          locationRegionIds: [COUNTRY, PROVINCE_B],
        },
        'workspace-1',
      ),
    ).rejects.toMatchObject({ message: 'PROJECT_REGION_COUNTRY_MISMATCH' });
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('rejects regions that resolve to different countries', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.region.findMany.mockResolvedValue([
      {
        id: PROVINCE_A,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.PROVINCE,
        parentId: COUNTRY,
      },
      {
        id: PROVINCE_B,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.PROVINCE,
        parentId: OTHER_COUNTRY,
      },
    ]);
    prisma.region.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        administrativeLevel: RegionAdministrativeLevel.COUNTRY,
        parentId: null,
      }),
    );

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          locationRegionIds: [PROVINCE_A, PROVINCE_B],
        },
        'workspace-1',
      ),
    ).rejects.toMatchObject({ message: 'PROJECT_REGION_COUNTRY_MISMATCH' });
    expect(tx.project.create).not.toHaveBeenCalled();
  });

  it('stores one row when the same canonical id is submitted twice', async () => {
    const { service, prisma, tx, classification } = createHarness();
    classification.getLineage.mockResolvedValue(
      lineage(ROOT, ConstructionClassificationLevel.JENIS_PENGADAAN, ROOT),
    );
    prisma.region.findMany.mockResolvedValue([
      {
        id: COUNTRY,
        isActive: true,
        administrativeLevel: RegionAdministrativeLevel.COUNTRY,
        parentId: null,
      },
    ]);

    await service.create(
      {
        name: 'Project',
        code: 'RI01B',
        classificationNodeIds: [ROOT, ROOT],
        locationRegionIds: [COUNTRY, COUNTRY],
      },
      'workspace-1',
    );

    expect(classification.getLineage).toHaveBeenCalledTimes(1);
    expect(tx.projectClassificationSelection.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 'project-1', classificationNodeId: ROOT }],
    });
    expect(tx.projectRegionSelection.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 'project-1', regionId: COUNTRY }],
    });
  });

  it('does not commit the project when selection persistence fails', async () => {
    const { service, tx, classification, committed } = createHarness();
    classification.getLineage.mockResolvedValue(
      lineage(ROOT, ConstructionClassificationLevel.JENIS_PENGADAAN, ROOT),
    );
    tx.projectClassificationSelection.createMany.mockRejectedValue(
      new Error('selection write failed'),
    );

    await expect(
      service.create(
        {
          name: 'Project',
          code: 'RI01B',
          classificationNodeIds: [ROOT],
        },
        'workspace-1',
      ),
    ).rejects.toThrow('Gagal membuat proyek');
    expect(tx.project.create).toHaveBeenCalled();
    expect(tx.boqStructure.create).toHaveBeenCalled();
    expect(committed()).toBe(false);
  });

  it('returns canonical classification and region ids from relations', async () => {
    const { service, prisma } = createHarness();
    prisma.project.findUnique.mockResolvedValue({
      budgetBaseline: new Prisma.Decimal('250000000.00'),
      mainMaterialSpec: 'Beton K-300',
      classificationSelections: [
        {
          classificationNode: {
            id: KATEGORI_A,
            level: ConstructionClassificationLevel.KATEGORI,
            name: 'Bina Marga',
            code: 'BM',
            parentId: ROOT,
          },
        },
      ],
      regionSelections: [
        {
          region: {
            id: PROVINCE_A,
            code: '81',
            name: 'Maluku',
            administrativeLevel: RegionAdministrativeLevel.PROVINCE,
            parentId: COUNTRY,
          },
        },
      ],
    });

    await expect(service.getIntakeContext('project-1')).resolves.toEqual({
      budgetBaseline: new Prisma.Decimal('250000000.00'),
      mainMaterialSpec: 'Beton K-300',
      classificationSelections: [
        {
          id: KATEGORI_A,
          level: ConstructionClassificationLevel.KATEGORI,
          name: 'Bina Marga',
          code: 'BM',
          parentId: ROOT,
        },
      ],
      locationSelections: [
        {
          id: PROVINCE_A,
          code: '81',
          name: 'Maluku',
          administrativeLevel: RegionAdministrativeLevel.PROVINCE,
          parentId: COUNTRY,
        },
      ],
    });

    const select = prisma.project.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('description');
    expect(select).not.toHaveProperty('location');
    expect(select).not.toHaveProperty('address');
  });

  it('reads project intake context with project access and PROJECT_VIEW', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ProjectController.prototype.getIntakeContext),
    ).toEqual(expect.arrayContaining([ProjectAccessGuard, PermissionsGuard]));
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ProjectController.prototype.getIntakeContext),
    ).toEqual(['PROJECT_VIEW']);
  });
});
