import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectIntakeContextDto } from './dto/update-project-intake-context.dto';
import { ProjectService } from './project.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';

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

describe('ProjectService initiateSetup collision guard', () => {
  function createSetupHarness(drafts: Array<{ id: string; name: string; status: string }>) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'project-1' }]),
      boqStructure: {
        findMany: jest.fn().mockResolvedValue(drafts),
        create: jest.fn().mockResolvedValue({ id: 'created-draft' }),
      },
      boqItem: {
        count: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'item-1' }),
      },
      rabDocument: {
        create: jest.fn().mockResolvedValue({ id: 'rab-1' }),
      },
      projectBaseline: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'baseline-1' }),
      },
      progressReport: {
        create: jest.fn().mockResolvedValue({ id: 'report-1' }),
      },
      project: {
        update: jest.fn().mockResolvedValue({ id: 'project-1' }),
      },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ProjectService(prisma as any, {} as any, {} as any);
    return { service, tx };
  }

  it('reuses one arbitrarily named DRAFT and makes a second initiate call a no-op', async () => {
    const { service, tx } = createSetupHarness([
      { id: 'owner-draft', name: 'Nama Bebas Owner', status: 'DRAFT' },
    ]);
    tx.boqItem.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const payload = {
      items: [{ wbsCode: '1', name: 'Mobilisasi', itemType: 'WORK_ITEM', quantity: 2, unit: 'ls', unitPrice: 100 }],
    } as any;

    const first = await service.initiateSetup('project-1', payload);
    const second = await service.initiateSetup('project-1', payload);

    expect(second).toEqual(first);
    expect(tx.boqStructure.create).not.toHaveBeenCalled();
    expect(tx.boqItem.create).toHaveBeenCalledTimes(1);
    expect(tx.boqItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ boqStructureId: 'owner-draft' }) });
    expect(tx.rabDocument.create).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
    expect(tx.progressReport.create).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('rejects multiple DRAFT containers without inspecting their names or writing setup artifacts', async () => {
    const { service, tx } = createSetupHarness([
      { id: 'draft-1', name: 'First Arbitrary Name', status: 'DRAFT' },
      { id: 'draft-2', name: 'Second Unrelated Name', status: 'DRAFT' },
    ]);

    await expect(service.initiateSetup('project-1', { items: [] })).rejects.toThrow('MULTIPLE_DRAFT_BOQ_STRUCTURES');

    expect(tx.boqItem.count).not.toHaveBeenCalled();
    expect(tx.boqStructure.create).not.toHaveBeenCalled();
    expect(tx.boqItem.create).not.toHaveBeenCalled();
    expect(tx.rabDocument.create).not.toHaveBeenCalled();
    expect(tx.projectBaseline.create).not.toHaveBeenCalled();
    expect(tx.progressReport.create).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
  });
});

describe('ProjectService initiateSetup GATE-2A price truth', () => {
  function createHarness() {
    const boqItemCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `item-${boqItemCreate.mock.calls.length}`, ...data }),
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'project-1' }]),
      boqStructure: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'structure-1' }),
      },
      boqItem: {
        count: jest.fn().mockResolvedValue(0),
        create: boqItemCreate,
      },
    };
    const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    const service = new ProjectService(prisma as any, {} as any, {} as any);
    return { service, boqItemCreate };
  }

  /** Every created row must match exactly one of the three GATE-2A truth shapes (test 6). */
  function assertTruthfulShape(data: Record<string, any>) {
    if (data.unitPrice === null) {
      expect(data.lineTotal).toBeNull();
      expect(data.priceOrigin).toBeNull();
    } else {
      expect(data.lineTotal).not.toBeNull();
      expect(data.priceOrigin).toBe('MANUAL_CLIENT');
    }
  }

  it('WORK_ITEM with omitted unitPrice stores unitPrice=null, lineTotal=null, priceOrigin=null (test 1)', async () => {
    const { service, boqItemCreate } = createHarness();
    await service.initiateSetup('project-1', {
      items: [{ wbsCode: '1', name: 'Tanpa harga', itemType: 'WORK_ITEM', quantity: 5, unit: 'ls' }],
    } as any);

    const data = boqItemCreate.mock.calls[0][0].data as Record<string, any>;
    expect(data.unitPrice).toBeNull();
    expect(data.lineTotal).toBeNull();
    expect(data.priceOrigin).toBeNull();
    assertTruthfulShape(data);
  });

  it('WORK_ITEM with explicit zero unitPrice stores unitPrice=0, lineTotal=0, priceOrigin=MANUAL_CLIENT (test 2)', async () => {
    const { service, boqItemCreate } = createHarness();
    await service.initiateSetup('project-1', {
      items: [{ wbsCode: '1', name: 'Harga nol', itemType: 'WORK_ITEM', quantity: 5, unit: 'ls', unitPrice: 0 }],
    } as any);

    const data = boqItemCreate.mock.calls[0][0].data as Record<string, any>;
    expect(data.unitPrice.toString()).toBe('0');
    expect(data.lineTotal.toString()).toBe('0');
    expect(data.priceOrigin).toBe('MANUAL_CLIENT');
    assertTruthfulShape(data);
  });

  it('WORK_ITEM with explicit non-zero unitPrice stores exact unitPrice/lineTotal, priceOrigin=MANUAL_CLIENT (test 3)', async () => {
    const { service, boqItemCreate } = createHarness();
    await service.initiateSetup('project-1', {
      items: [{ wbsCode: '1', name: 'Harga nyata', itemType: 'WORK_ITEM', quantity: 3, unit: 'ls', unitPrice: 25000 }],
    } as any);

    const data = boqItemCreate.mock.calls[0][0].data as Record<string, any>;
    expect(data.unitPrice.toString()).toBe('25000');
    expect(data.lineTotal.toString()).toBe('75000');
    expect(data.priceOrigin).toBe('MANUAL_CLIENT');
    assertTruthfulShape(data);
  });

  it('FOLDER and NOTE rows always store unitPrice=null, lineTotal=null, priceOrigin=null regardless of any stray unitPrice input (test 4)', async () => {
    const { service, boqItemCreate } = createHarness();
    await service.initiateSetup('project-1', {
      items: [
        { wbsCode: '1', name: 'Folder', itemType: 'FOLDER' },
        { wbsCode: '1.1', name: 'Catatan', itemType: 'NOTE' },
      ],
    } as any);

    expect(boqItemCreate).toHaveBeenCalledTimes(2);
    for (const call of boqItemCreate.mock.calls) {
      const data = call[0].data as Record<string, any>;
      expect(data.unitPrice).toBeNull();
      expect(data.lineTotal).toBeNull();
      expect(data.priceOrigin).toBeNull();
      assertTruthfulShape(data);
    }
  });

  it('a mixed batch (omitted, zero, non-zero, folder, note) always produces rows matching the truth-constraint shape (test 6)', async () => {
    const { service, boqItemCreate } = createHarness();
    await service.initiateSetup('project-1', {
      items: [
        { wbsCode: '1', name: 'Folder', itemType: 'FOLDER' },
        { wbsCode: '1.1', name: 'Tanpa harga', itemType: 'WORK_ITEM', quantity: 1, unit: 'ls' },
        { wbsCode: '1.2', name: 'Harga nol', itemType: 'WORK_ITEM', quantity: 1, unit: 'ls', unitPrice: 0 },
        { wbsCode: '1.3', name: 'Harga nyata', itemType: 'WORK_ITEM', quantity: 2, unit: 'ls', unitPrice: 500 },
        { wbsCode: '1.4', name: 'Catatan', itemType: 'NOTE' },
      ],
    } as any);

    expect(boqItemCreate).toHaveBeenCalledTimes(5);
    for (const call of boqItemCreate.mock.calls) {
      assertTruthfulShape(call[0].data as Record<string, any>);
    }
  });
});

describe('UpdateProjectIntakeContextDto validation', () => {
  it('rejects invalid decimal strings', async () => {
    const dto = plainToInstance(UpdateProjectIntakeContextDto, { budgetBaseline: '1,000' });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});

describe('ProjectService saveDraftBoq GATE-2A server-row protection', () => {
  const SERVER_ROW_ID = 'server-row-1';
  const STRUCTURE_ID = 'structure-1';

  function buildServerRow(overrides: Record<string, unknown> = {}) {
    return {
      id: SERVER_ROW_ID,
      boqStructureId: STRUCTURE_ID,
      itemType: 'WORK_ITEM',
      quantity: new Prisma.Decimal('5'),
      unit: 'M1',
      unitPrice: new Prisma.Decimal('200000.00'),
      lineTotal: new Prisma.Decimal('1000000.00'),
      ahspVersionId: 'ahsp-version-1',
      ahspSnapshotId: null,
      priceOrigin: 'SERVER_COST_KERNEL',
      calculationOccurrenceId: 'occurrence-1',
      calculationAsOfDate: new Date('2026-07-31'),
      calculatedAt: new Date('2026-07-31T01:00:00.000Z'),
      calculationPolicyVersion: 'RAB_KERNEL_PERSISTENCE_GRADE_A_V1',
      ...overrides,
    };
  }

  function createPrismaMock(existingItems: unknown[]) {
    let nextId = 0;
    const boqItemCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `new-row-${nextId++}`, ...data }),
    );
    const boqItemDeleteMany = jest.fn().mockResolvedValue({ count: existingItems.length });
    const rabDocumentUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'project-1', status: 'PLANNED' }]),
      projectBaseline: { count: jest.fn().mockResolvedValue(0) },
      rabDocument: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: rabDocumentUpdateMany,
        create: jest.fn().mockResolvedValue({}),
      },
      boqStructure: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: STRUCTURE_ID,
          projectId: 'project-1',
          name: 'Working Draft',
          status: 'DRAFT',
        }),
      },
      boqItem: {
        findMany: jest.fn().mockResolvedValue(existingItems),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: boqItemDeleteMany,
        create: boqItemCreate,
      },
    };
    const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    return { prisma, tx, boqItemCreate, boqItemDeleteMany, rabDocumentUpdateMany };
  }

  function buildService(prisma: unknown) {
    return new ProjectService(
      prisma as any,
      {} as any,
      new RabLifecyclePolicyService({} as any),
    );
  }

  /** Unit-test convenience: the same plain-object rows array is both the (unvalidated-here) dto.rows and the raw pre-transform body, since these tests bypass the real ValidationPipe/class-transformer entirely. */
  const save = (service: ProjectService, rows: Record<string, unknown>[]) =>
    service.saveDraftBoq('project-1', { rows } as any, rows);

  it('rejects a client unitPrice sent for an existing server-authored row (test 9)', async () => {
    const { prisma, boqItemDeleteMany } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await expect(
      save(service, [
        {
          tempId: SERVER_ROW_ID,
          itemType: 'WORK_ITEM',
          name: 'Pekerjaan Server',
          quantity: 5,
          unit: 'M1',
          unitPrice: 555,
        },
      ]),
    ).rejects.toMatchObject({ message: 'SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN' });
    // Fail-closed BEFORE the destructive full-replace — zero mutation.
    expect(boqItemDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects an explicit unitPrice:null sent for an existing server-authored row — explicit null is still an overwrite attempt', async () => {
    const { prisma, boqItemDeleteMany } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await expect(
      save(service, [
        {
          tempId: SERVER_ROW_ID,
          itemType: 'WORK_ITEM',
          name: 'Pekerjaan Server',
          quantity: 5,
          unit: 'M1',
          unitPrice: null,
        },
      ]),
    ).rejects.toMatchObject({ message: 'SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN' });
    expect(boqItemDeleteMany).not.toHaveBeenCalled();
  });

  it('allows a server row to be saved when the unitPrice key is genuinely absent (not sent at all)', async () => {
    const { prisma, boqItemCreate } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await save(service, [
      {
        tempId: SERVER_ROW_ID,
        itemType: 'WORK_ITEM',
        name: 'Pekerjaan Server',
        quantity: 5,
        unit: 'M1',
        // unitPrice intentionally omitted
      },
    ]);

    const data = boqItemCreate.mock.calls[0][0].data as Record<string, any>;
    expect(data.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(data.unitPrice.toString()).toBe('200000');
  });

  it('rejects a quantity change for an existing server-authored row, requiring explicit recalculation', async () => {
    const { prisma } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await expect(
      save(service, [
        {
          tempId: SERVER_ROW_ID,
          itemType: 'WORK_ITEM',
          name: 'Pekerjaan Server',
          quantity: 9,
          unit: 'M1',
        },
      ]),
    ).rejects.toMatchObject({
      message: 'SERVER_ROW_INPUT_CHANGED_REQUIRES_RECALCULATION',
    });
  });

  it('rejects when an existing server-authored row is omitted from the payload entirely (test 4.1 zero appearances)', async () => {
    const { prisma, boqItemDeleteMany } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await expect(
      save(service, [
        { tempId: 'unrelated-row', itemType: 'WORK_ITEM', name: 'Lain', quantity: 1, unit: 'ls', unitPrice: 1 },
      ]),
    ).rejects.toMatchObject({
      message: 'SERVER_ROW_OMISSION_REQUIRES_EXPLICIT_COMMAND',
    });
    expect(boqItemDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects when an existing server-authored row id is referenced twice (test 4.1 duplicate reference)', async () => {
    const { prisma } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await expect(
      save(service, [
        { tempId: SERVER_ROW_ID, itemType: 'WORK_ITEM', name: 'A', quantity: 5, unit: 'M1' },
        { tempId: SERVER_ROW_ID, itemType: 'WORK_ITEM', name: 'B', quantity: 5, unit: 'M1' },
      ]),
    ).rejects.toMatchObject({ message: 'DUPLICATE_TEMP_ID' });
  });

  it('rejects any two incoming rows sharing the same tempId before mutation, independent of server-row status', async () => {
    const { prisma, boqItemDeleteMany } = createPrismaMock([]);
    const service = buildService(prisma);

    await expect(
      save(service, [
        { tempId: 'dup', itemType: 'WORK_ITEM', name: 'A', quantity: 1, unit: 'ls', unitPrice: 1 },
        { tempId: 'dup', itemType: 'WORK_ITEM', name: 'B', quantity: 1, unit: 'ls', unitPrice: 2 },
      ]),
    ).rejects.toMatchObject({ message: 'DUPLICATE_TEMP_ID' });
    expect(boqItemDeleteMany).not.toHaveBeenCalled();
  });

  it('preserves an unchanged server-authored line across an unrelated draft save (test 10)', async () => {
    const { prisma, boqItemCreate } = createPrismaMock([buildServerRow()]);
    const service = buildService(prisma);

    await save(service, [
      {
        tempId: SERVER_ROW_ID,
        itemType: 'WORK_ITEM',
        name: 'Pekerjaan Server (renamed structurally)',
        quantity: 5,
        unit: 'M1',
      },
      {
        tempId: 'new-manual-row',
        itemType: 'WORK_ITEM',
        name: 'Pekerjaan Manual Baru',
        quantity: 1,
        unit: 'ls',
        unitPrice: 50000,
      },
    ]);

    const serverRowCreateCall = boqItemCreate.mock.calls.find(
      (call) => call[0].data.name === 'Pekerjaan Server (renamed structurally)',
    );
    expect(serverRowCreateCall).toBeDefined();
    const data = serverRowCreateCall![0].data as Record<string, any>;
    expect(data.priceOrigin).toBe('SERVER_COST_KERNEL');
    expect(data.unitPrice.toString()).toBe('200000');
    expect(data.lineTotal.toString()).toBe('1000000');
    expect(data.calculationOccurrenceId).toBe('occurrence-1');
    expect(data.calculationPolicyVersion).toBe('RAB_KERNEL_PERSISTENCE_GRADE_A_V1');
    expect(data.ahspVersionId).toBe('ahsp-version-1');

    const manualRowCreateCall = boqItemCreate.mock.calls.find(
      (call) => call[0].data.name === 'Pekerjaan Manual Baru',
    );
    expect(manualRowCreateCall![0].data.priceOrigin).toBe('MANUAL_CLIENT');
  });

  it('keeps existing manual-row behavior valid — client unitPrice is honored for a plain new row (test 14)', async () => {
    const { prisma, boqItemCreate } = createPrismaMock([]);
    const service = buildService(prisma);

    await save(service, [
      {
        tempId: 'manual-1',
        itemType: 'WORK_ITEM',
        name: 'Pekerjaan Manual',
        quantity: 2,
        unit: 'ls',
        unitPrice: 100,
      },
    ]);

    const data = boqItemCreate.mock.calls[0][0].data as Record<string, any>;
    expect(data.priceOrigin).toBe('MANUAL_CLIENT');
    expect(data.calculationOccurrenceId).toBeNull();
    expect(data.unitPrice.toString()).toBe('100');
    expect(data.lineTotal.toString()).toBe('200');
  });

  it('an unpriced row (no unitPrice at all) stores priceOrigin=NULL, never MANUAL_CLIENT (§3.1 / §2.1.A)', async () => {
    const { prisma, boqItemCreate } = createPrismaMock([]);
    const service = buildService(prisma);

    await save(service, [
      { tempId: 'unpriced-1', itemType: 'WORK_ITEM', name: 'Belum diisi', quantity: 3, unit: 'ls' },
    ]);

    const data = boqItemCreate.mock.calls[0][0].data as Record<string, any>;
    expect(data.unitPrice).toBeNull();
    expect(data.lineTotal).toBeNull();
    expect(data.priceOrigin).toBeNull();
    expect(data.calculationOccurrenceId).toBeNull();
  });

  it('nulls stale RabDocument totals within the same transaction when the replacement draft is incomplete (§4.5)', async () => {
    const { prisma, rabDocumentUpdateMany } = createPrismaMock([]);
    const service = buildService(prisma);

    await save(service, [
      { tempId: 'priced-1', itemType: 'WORK_ITEM', name: 'A', quantity: 1, unit: 'ls', unitPrice: 100 },
      { tempId: 'unpriced-1', itemType: 'WORK_ITEM', name: 'B', quantity: 1, unit: 'ls' },
    ]);

    expect(rabDocumentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { totalBaseCost: null, totalFinalCost: null },
      }),
    );
  });
});

describe('ProjectService getReality GATE-2A active-baseline total truth', () => {
  function createHarness(options: {
    hasReport?: boolean;
    baseline?: { rabDocumentId: string | null } | null;
    rab?: { totalBaseCost: Prisma.Decimal | null } | null;
  }) {
    const prisma = {
      progressReport: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            options.hasReport === false
              ? []
              : [{ id: 'report-1', entries: [] }],
          ),
      },
      projectBaseline: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.baseline === undefined ? null : options.baseline),
      },
      rabDocument: {
        findUnique: jest
          .fn()
          .mockResolvedValue(options.rab === undefined ? null : options.rab),
      },
    };
    const deviationService = { computeAndPersist: jest.fn().mockResolvedValue([]) };
    const service = new ProjectService(prisma as any, deviationService as any, {} as any);
    return { service, prisma, deviationService };
  }

  it('returns UNAVAILABLE — never planned cost 0 — when the active baseline RabDocument totalBaseCost is null (test 7)', async () => {
    const { service } = createHarness({
      baseline: { rabDocumentId: 'rab-1' },
      rab: { totalBaseCost: null },
    });

    const result = await service.getReality('project-1');

    expect(result).toEqual({
      available: false,
      status: 'UNAVAILABLE',
      message: expect.any(String),
      data: null,
    });
    expect(result).not.toHaveProperty('overallPlannedCost');
  });

  it('returns UNAVAILABLE when the active baseline has no resolvable RabDocument at all (test 8)', async () => {
    const { service } = createHarness({
      baseline: { rabDocumentId: 'rab-missing' },
      rab: null,
    });

    const result = await service.getReality('project-1');

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.data).toBeNull();
  });

  it('returns UNAVAILABLE when the active baseline itself carries no rabDocumentId', async () => {
    const { service } = createHarness({
      baseline: { rabDocumentId: null },
    });

    const result = await service.getReality('project-1');

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.data).toBeNull();
  });

  it('returns the exact planned total when the active baseline RabDocument total is valid and non-null (test 9)', async () => {
    const { service } = createHarness({
      baseline: { rabDocumentId: 'rab-1' },
      rab: { totalBaseCost: new Prisma.Decimal('1234567.89') },
    });

    const result = await service.getReality('project-1');

    expect(result.status).toBeUndefined();
    expect((result as any).overallPlannedCost).toBe(1234567.89);
  });

  it('preserves the existing UNAVAILABLE state when the primary reality input (progress report) is absent (test 10)', async () => {
    const { service } = createHarness({ hasReport: false });

    const result = await service.getReality('project-1');

    expect(result).toEqual({
      available: false,
      status: 'UNAVAILABLE',
      message: 'Data realitas belum tersedia',
      data: null,
    });
  });
});
