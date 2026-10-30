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
    $queryRaw: jest.fn().mockResolvedValue([{ id: PROJECT, status: 'PLANNED' }]),
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
