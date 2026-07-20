import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectIntakeContextDto } from './dto/update-project-intake-context.dto';
import { ProjectService } from './project.service';

describe('ProjectService P7C intake contract', () => {
  function createPrismaMock() {
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
    };
    const prisma = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: 'project-1' }),
        update: jest.fn().mockResolvedValue({ id: 'project-1' }),
      },
      projectBaseline: {
        count: jest.fn().mockResolvedValue(0),
      },
      boqItem: {
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    return { prisma, tx };
  }

  it('accepts a public create payload without client-supplied workspaceId', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      name: 'Project',
      code: 'SERVER-SCOPED',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('stores budgetBaseline and mainMaterialSpec on create', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.create({
      name: 'Project',
      code: 'P7C',
      description: 'Narasi',
      budgetBaseline: '250000000.00',
      mainMaterialSpec: '  Beton K-300  ',
    }, 'workspace-1');

    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Narasi',
        budgetBaseline: new Prisma.Decimal('250000000.00'),
        mainMaterialSpec: 'Beton K-300',
      }),
    });
    expect(tx.boqStructure.create).toHaveBeenCalledWith({
      data: { projectId: 'project-1', name: 'Working Draft', version: 1, status: 'DRAFT' },
    });
  });

  it('keeps omitted budgetBaseline and mainMaterialSpec null on create data', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.create({ name: 'Project', code: 'P7C' }, 'workspace-1');

    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        budgetBaseline: undefined,
        mainMaterialSpec: undefined,
      }),
    });
  });

  it('normalizes whitespace spec to null on create', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.create({
      name: 'Project',
      code: 'P7C',
      mainMaterialSpec: '   ',
    }, 'workspace-1');

    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mainMaterialSpec: null }),
    });
  });

  it.each([
    ['negative pagu', CreateProjectDto, { name: 'P', code: 'P', budgetBaseline: '-1' }],
    ['invalid decimal', CreateProjectDto, { name: 'P', code: 'P', budgetBaseline: 'abc' }],
    ['more than 2 decimals', CreateProjectDto, { name: 'P', code: 'P', budgetBaseline: '1.234' }],
  ])('rejects %s in DTO validation', async (_label, dtoClass, payload) => {
    const dto = plainToInstance(dtoClass, payload);
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('patches budget only', async () => {
    const { prisma } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.updateIntakeContext('project-1', { budgetBaseline: '100000.50' });

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { budgetBaseline: new Prisma.Decimal('100000.50') },
    });
  });

  it('patches spec only', async () => {
    const { prisma } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.updateIntakeContext('project-1', { mainMaterialSpec: 'Semen Tipe I' });

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { mainMaterialSpec: 'Semen Tipe I' },
    });
  });

  it('does not clear omitted fields', async () => {
    const { prisma } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.updateIntakeContext('project-1', {});

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {},
    });
  });

  it('clears nullable fields when PATCH receives null', async () => {
    const { prisma } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.updateIntakeContext('project-1', { budgetBaseline: null, mainMaterialSpec: null });

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { budgetBaseline: null, mainMaterialSpec: null },
    });
  });

  it('ignores workspaceId and organizationId body fields', async () => {
    const { prisma } = createPrismaMock();
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await service.updateIntakeContext('project-1', {
      budgetBaseline: '1',
      workspaceId: 'attack',
      organizationId: 'attack',
    } as any);

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { budgetBaseline: new Prisma.Decimal('1') },
    });
  });

  it('rejects PATCH when an active official baseline exists', async () => {
    const { prisma } = createPrismaMock();
    prisma.projectBaseline.count.mockResolvedValue(1);
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await expect(service.updateIntakeContext('project-1', { budgetBaseline: '1' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('does not parse legacy description for budget or spec', async () => {
    const { prisma } = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      budgetBaseline: null,
      mainMaterialSpec: null,
      description: 'Pagu Anggaran: 999999999\nSpesifikasi Material Utama: Beton',
    });
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await expect(service.getIntakeMode('project-1')).resolves.toMatchObject({
      pagu: { status: 'MISSING' },
      specification: { status: 'MISSING' },
    });
  });

  it('derives mode from database facts without fixture data', async () => {
    const { prisma } = createPrismaMock();
    prisma.project.findUnique.mockResolvedValue({
      id: 'project-1',
      budgetBaseline: new Prisma.Decimal('100.00'),
      mainMaterialSpec: 'Beton',
    });
    prisma.boqItem.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const service = new ProjectService(prisma as any, {} as any, {} as any);

    await expect(service.getIntakeMode('project-1')).resolves.toMatchObject({
      mode: 'C',
      boq: { source: 'DRAFT' },
    });
  });
});

describe('UpdateProjectIntakeContextDto validation', () => {
  it('rejects invalid decimal strings', async () => {
    const dto = plainToInstance(UpdateProjectIntakeContextDto, { budgetBaseline: '1,000' });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
