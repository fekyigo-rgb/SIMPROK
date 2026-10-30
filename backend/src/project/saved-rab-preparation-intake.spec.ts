import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProjectIntakeContextDto } from './dto/update-project-intake-context.dto';
import { ProjectService } from './project.service';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REGION_OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REGION_NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function harness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: PROJECT, status: 'PLANNED', priceSelectionPreferenceMode: null }]),
    projectBaseline: { count: jest.fn().mockResolvedValue(0) },
    projectRegionSelection: {
      findMany: jest.fn().mockResolvedValue([{ regionId: REGION_OLD }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    project: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: PROJECT }),
      update: jest.fn().mockResolvedValue({ id: PROJECT }),
    },
  };
  const db = {
    project: { findUnique: jest.fn().mockResolvedValue({ id: PROJECT }) },
    projectBaseline: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((fn: (tx: typeof tx) => unknown) => fn(tx)),
  };
  const lifecycle = { evaluateInTransaction: jest.fn().mockResolvedValue({ canEditDraft: true, reasonCode: null }) };
  const service = new ProjectService(db as never, {} as never, lifecycle as never);
  // Independent canonical Region validation is already covered by
  // project-canonical-context tests. These tests protect the new transaction.
  jest.spyOn(service as never, 'assertProjectRegionSelections' as never)
    .mockResolvedValue(undefined as never);
  return { service, db, tx, lifecycle };
}

describe('F03A project-owned price-selection INTENT only', () => {
  it('keeps the implicit default absent and refuses a write without prior expected truth', async () => {
    const { service, tx } = harness();
    await expect(service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: 'LOWEST',
    })).rejects.toThrow('PROJECT_PRICE_PREFERENCE_EXPECTED_REQUIRED');
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('stores explicit LOWEST on the existing Project under row lock and draft lifecycle', async () => {
    const { service, db, tx, lifecycle } = harness();
    await service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: 'LOWEST',
      expectedPriceSelectionPreferenceMode: null,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(lifecycle.evaluateInTransaction).toHaveBeenCalled();
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT },
      data: {
        priceSelectionPreferenceMode: 'LOWEST',
        priceSelectionPreferencePolicyVersion: 'F03A_PROJECT_PRICE_INTENT_V1',
      },
    });
    expect(tx.projectRegionSelection.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a changed preference with no overwrite', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValue([{ id: PROJECT, status: 'PLANNED', priceSelectionPreferenceMode: 'HIGHEST' }]);
    await expect(service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: 'LOWEST',
      expectedPriceSelectionPreferenceMode: null,
    })).rejects.toThrow('PROJECT_PRICE_PREFERENCE_CHANGED_RELOAD');
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('refuses locked RAB even when expected price preference matches', async () => {
    const { service, tx, lifecycle } = harness();
    lifecycle.evaluateInTransaction.mockResolvedValue({ canEditDraft: false, reasonCode: 'RAB_LOCKED' });
    await expect(service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: 'HIGHEST',
      expectedPriceSelectionPreferenceMode: null,
    })).rejects.toThrow('PROJECT_PRICE_PREFERENCE_LIFECYCLE_LOCKED');
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('clears explicit preference and version together, retaining source and money', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValue([{ id: PROJECT, status: 'PLANNED', priceSelectionPreferenceMode: 'MIDDLE' }]);
    await service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: null,
      expectedPriceSelectionPreferenceMode: 'MIDDLE',
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT },
      data: {
        priceSelectionPreferenceMode: null,
        priceSelectionPreferencePolicyVersion: null,
      },
    });
  });

  it('never performs a redundant update and never combines a region replacement', async () => {
    const { service, tx } = harness();
    await service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: null,
      expectedPriceSelectionPreferenceMode: null,
    });
    expect(tx.project.update).not.toHaveBeenCalled();
    await expect(service.updateIntakeContext(PROJECT, {
      priceSelectionPreferenceMode: 'LOWEST',
      expectedPriceSelectionPreferenceMode: null,
      locationRegionIds: [REGION_NEW],
      expectedLocationRegionIds: [REGION_OLD],
    })).rejects.toThrow('PROJECT_PRICE_PREFERENCE_CHANGE_SEPARATE_FROM_REGION');
  });

  it('returns stored price preference with explicit INTENT_ONLY marker', async () => {
    const { service, db } = harness();
    db.project.findUnique.mockResolvedValue({
      id: PROJECT, budgetBaseline: null, mainMaterialSpec: null,
      priceSelectionPreferenceMode: 'MIDDLE',
      priceSelectionPreferencePolicyVersion: 'F03A_PROJECT_PRICE_INTENT_V1',
      classificationSelections: [], regionSelections: [],
    });
    expect(await service.getIntakeContext(PROJECT)).toMatchObject({
      priceSelectionPreferenceMode: 'MIDDLE',
      priceSelectionPreferencePolicyVersion: 'F03A_PROJECT_PRICE_INTENT_V1',
      priceSelectionAuthority: 'INTENT_ONLY_NOT_ACTIVE',
    });
  });

  it('rejects invalid preferences at existing DTO boundary', async () => {
    const bad = plainToInstance(UpdateProjectIntakeContextDto, {
      priceSelectionPreferenceMode: 'CHEAPEST_ARBITRARY',
      expectedPriceSelectionPreferenceMode: null,
    });
    expect((await validate(bad)).length).toBeGreaterThan(0);
    const good = plainToInstance(UpdateProjectIntakeContextDto, {
      priceSelectionPreferenceMode: 'MIDDLE',
      expectedPriceSelectionPreferenceMode: null,
    });
    expect(await validate(good)).toHaveLength(0);
  });
});

describe('RAB-37 saved Preparation — canonical PATCH safety', () => {
  it('rejects location change without an expected original selection', async () => {
    const { service, tx } = harness();
    await expect(service.updateIntakeContext(PROJECT, {
      locationRegionIds: [REGION_NEW],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.projectRegionSelection.deleteMany).not.toHaveBeenCalled();
  });

  it('writes the new region only inside the official transaction and preserves BOQ', async () => {
    const { service, db, tx } = harness();
    const result = await service.updateIntakeContext(PROJECT, {
      locationRegionIds: [REGION_NEW],
      expectedLocationRegionIds: [REGION_OLD],
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.projectRegionSelection.deleteMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT },
    });
    expect(tx.projectRegionSelection.createMany).toHaveBeenCalledWith({
      data: [{ projectId: PROJECT, regionId: REGION_NEW }],
    });
    expect(result).toMatchObject({ id: PROJECT, locationRegionIds: [REGION_NEW] });
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('does not mistake materialized undefined optional DTO fields for a price command', async () => {
    const { service, tx } = harness();
    const dto = plainToInstance(UpdateProjectIntakeContextDto, {
      locationRegionIds: [REGION_NEW],
      expectedLocationRegionIds: [REGION_OLD],
    });
    // Regression: class-transformer/TS emit can materialize absent optional
    // properties as own undefined fields. They must not invoke F03A.
    Object.defineProperty(dto, 'priceSelectionPreferenceMode', {
      value: undefined, configurable: true, enumerable: true,
    });
    Object.defineProperty(dto, 'expectedPriceSelectionPreferenceMode', {
      value: undefined, configurable: true, enumerable: true,
    });
    await service.updateIntakeContext(PROJECT, dto);
    expect(tx.projectRegionSelection.createMany).toHaveBeenCalledTimes(1);
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('rejects a concurrent selection change without overwriting it', async () => {
    const { service, tx } = harness();
    tx.projectRegionSelection.findMany.mockResolvedValue([{ regionId: REGION_NEW }]);
    await expect(service.updateIntakeContext(PROJECT, {
      locationRegionIds: [REGION_OLD],
      expectedLocationRegionIds: [REGION_OLD],
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectRegionSelection.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a RAB locked while the request was in flight', async () => {
    const { service, tx, lifecycle } = harness();
    lifecycle.evaluateInTransaction.mockResolvedValue({ canEditDraft: false, reasonCode: 'RAB_LOCKED' });
    await expect(service.updateIntakeContext(PROJECT, {
      locationRegionIds: [REGION_NEW],
      expectedLocationRegionIds: [REGION_OLD],
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectRegionSelection.deleteMany).not.toHaveBeenCalled();
  });

  it('does not rewrite an identical region selection', async () => {
    const { service, tx } = harness();
    await service.updateIntakeContext(PROJECT, {
      locationRegionIds: [REGION_OLD],
      expectedLocationRegionIds: [REGION_OLD],
    });
    expect(tx.projectRegionSelection.deleteMany).not.toHaveBeenCalled();
    expect(tx.projectRegionSelection.createMany).not.toHaveBeenCalled();
  });

  it('validates canonical UUID arrays at DTO boundary', async () => {
    const invalid = plainToInstance(UpdateProjectIntakeContextDto, {
      locationRegionIds: ['Jakarta Pusat'],
      expectedLocationRegionIds: [REGION_OLD],
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
    const valid = plainToInstance(UpdateProjectIntakeContextDto, {
      locationRegionIds: [REGION_NEW],
      expectedLocationRegionIds: [REGION_OLD],
    });
    expect(await validate(valid)).toHaveLength(0);
  });
});
