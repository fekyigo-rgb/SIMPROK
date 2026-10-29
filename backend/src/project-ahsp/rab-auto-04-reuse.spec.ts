import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_ALL_KEY } from '../common/decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAhspService } from './project-ahsp.service';
import { sameProvenBoqSourceFact } from './rab-auto-source-proof';
import { RabAutoProvenReuseController } from './rab-auto-04-reuse.controller';
import { RabAutoProvenReuseService } from './rab-auto-04-reuse.service';

describe('RAB-AUTO-04 — reuse only a proven SAME source identity', () => {
  const input = {
    projectId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000001',
    accountId: '30000000-0000-4000-8000-000000000001',
    businessPricingAsOfDate: '2026-10-29',
  };
  const id = '99999999-0000-4000-8000-000000000001';
  const region = '44444444-0000-4000-8000-000000000001';
  const version = '55555555-0000-4000-8000-000000000001';
  const base = {
    wbsNodeId: '66666666-0000-4000-8000-000000000001',
    wbsCode: '2.1',
    name: 'Saluran U Pracetak Tipe DS 10A (140 x 140 cm dengan tutup)',
    unit: 'm',
  };
  const target = (patch: Record<string, unknown> = {}) => ({
    ...base,
    id,
    ahspVersionId: null,
    workingOccurrenceId: null,
    calculationOccurrenceId: null,
    priceOrigin: null,
    ...patch,
  });
  const occurrence = (patch: Record<string, unknown> = {}) => ({
    id: '77777777-0000-4000-8000-000000000001',
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    ahspVersionId: version,
    referenceRegionId: region,
    businessPricingAsOfDate: new Date('2026-10-29T00:00:00.000Z'),
    createdByAccountId: input.accountId,
    idempotencyKey: 'manual-e1a-decision',
    ...patch,
  });
  const source = (patch: Record<string, unknown> = {}) => ({
    ...base,
    id: '88888888-0000-4000-8000-000000000001',
    ahspVersionId: version,
    workingOccurrenceId: '77777777-0000-4000-8000-000000000001',
    calculationOccurrenceId: null,
    priceOrigin: null,
    workingOccurrence: occurrence(),
    calculationOccurrence: null,
    ...patch,
  });
  let prisma: {
    boqItem: { findMany: jest.Mock };
    projectRegionSelection: { findMany: jest.Mock };
  };
  let ahsp: { selectForBoqItem: jest.Mock };
  let service: RabAutoProvenReuseService;
  beforeEach(() => {
    prisma = {
      boqItem: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([target()])
          .mockResolvedValueOnce([source()]),
      },
      projectRegionSelection: {
        findMany: jest.fn().mockResolvedValue([{ regionId: region }]),
      },
    };
    ahsp = {
      selectForBoqItem: jest.fn().mockResolvedValue({ id: 'created-occur' }),
    };
    service = new RabAutoProvenReuseService(
      prisma as unknown as PrismaService,
      ahsp as unknown as ProjectAhspService,
    );
  });

  it('requires a stable WBS node and EXACT source description/unit', () => {
    expect(sameProvenBoqSourceFact(base, { ...base })).toBe(true);
    expect(
      sameProvenBoqSourceFact(base, {
        ...base,
        name: base.name.replace('10A', '10B'),
      }),
    ).toBe(false);
    expect(
      sameProvenBoqSourceFact(base, {
        ...base,
        name: base.name.replace('140', '160'),
      }),
    ).toBe(false);
    expect(sameProvenBoqSourceFact(base, { ...base, unit: 'm1' })).toBe(false);
    expect(sameProvenBoqSourceFact(base, { ...base, wbsNodeId: null })).toBe(
      false,
    );
    expect(sameProvenBoqSourceFact(base, { ...base, wbsCode: '5.11' })).toBe(
      false,
    );
  });

  it('calls only EXISTING canonical writer with source proof and preserved context', async () => {
    const result = await service.execute(input);
    expect(result.summary).toEqual({ PROVEN_ASSOCIATION_REUSED: 1 });
    expect(result.automaticBindingPerformed).toBe(true);
    const selectionCalls = ahsp.selectForBoqItem.mock
      .calls as unknown as ReadonlyArray<readonly [Record<string, unknown>]>;
    expect(selectionCalls).toHaveLength(1);
    expect(selectionCalls[0]?.[0]).toMatchObject({
      ...input,
      boqItemId: id,
      referenceRegionId: region,
      ahspVersionId: version,
      reuseSourceBoqItemId: source().id,
    });
    expect(String(selectionCalls[0]?.[0].idempotencyKey)).toContain(
      'rab-auto-04-',
    );
    const calls = prisma.boqItem.findMany.mock
      .calls as unknown as ReadonlyArray<readonly [unknown]>;
    expect(calls[0]?.[0]).toMatchObject({
      where: {
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId: input.projectId,
          project: { workspaceId: input.workspaceId },
        },
      },
      take: 26,
    });
  });

  it('does not reuse if current target has an AHSP or prices', async () => {
    prisma.boqItem.findMany
      .mockReset()
      .mockResolvedValue([
        target({ ahspVersionId: version }),
        target({ id: 'other', priceOrigin: 'MANUAL_CLIENT' }),
      ]);
    const result = await service.execute(input);
    expect(result.results.every((row) => row.kind === 'ALREADY_DECIDED')).toBe(
      true,
    );
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('does not pick one of TWO prior associations', async () => {
    prisma.boqItem.findMany
      .mockReset()
      .mockResolvedValueOnce([target()])
      .mockResolvedValueOnce([source(), source({ id: '2' })]);
    expect((await service.execute(input)).summary).toEqual({
      MULTIPLE_SOURCE_DECISIONS: 1,
    });
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('cannot borrow an auto-derived source or stale price date/region', async () => {
    for (const patch of [
      { idempotencyKey: 'rab-auto-04-inherited' },
      { businessPricingAsOfDate: new Date('2026-10-28T00:00:00.000Z') },
      { referenceRegionId: 'other-region' },
      { createdByAccountId: null },
    ]) {
      prisma.boqItem.findMany
        .mockReset()
        .mockResolvedValueOnce([target()])
        .mockResolvedValueOnce([
          source({ workingOccurrence: occurrence(patch) }),
        ]);
      const result = await service.execute(input);
      expect(result.summary).toEqual({ SOURCE_CONTEXT_NOT_AUTHORIZED: 1 });
    }
    expect(ahsp.selectForBoqItem).not.toHaveBeenCalled();
  });

  it('isolates writer failure and refuses speculative success', async () => {
    ahsp.selectForBoqItem.mockRejectedValue(new Error('STALE_CONCURRENT_LINK'));
    expect((await service.execute(input)).summary).toEqual({
      REUSE_REVALIDATION_REQUIRED: 1,
    });
  });

  it('supports page limits and keeps all-of RAB/AHSP edit permissions', async () => {
    await expect(
      service.execute({ ...input, limit: '26' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const controller = new RabAutoProvenReuseController(service);
    expect(controller).toBeInstanceOf(RabAutoProvenReuseController);
    const desc = Object.getOwnPropertyDescriptor(
      RabAutoProvenReuseController.prototype,
      'execute',
    );
    expect(
      Reflect.getMetadata(PERMISSIONS_ALL_KEY, desc?.value as object),
    ).toEqual([PERMISSIONS.AHSP_VIEW, PERMISSIONS.RAB_DRAFT_EDIT]);
  });
});
