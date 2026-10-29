import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CostKernelService } from './cost-kernel.service';
import { RabKernelPersistenceService } from './rab-kernel-persistence.service';
import { RabAutoPriceReadyService } from './rab-auto-price-ready.service';
import { RabAutoPriceReadyController } from './rab-auto-price-ready.controller';
import { PERMISSIONS } from '../common/constants/permissions';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { COST_CALCULATION_STATUS } from './cost-kernel.contracts';

describe('RAB-AUTO-03 — reuse existing Cost Kernel and authoritative persistence', () => {
  const input = {
    projectId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000001',
    calculationAsOfDate: '2026-10-29',
  };
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    ahspVersionId: 'proven-version',
    workingOccurrenceId: 'proven-occurrence',
    priceOrigin: null,
    calculationAsOfDate: null,
    ...extra,
  });
  let prisma: { boqItem: { findMany: jest.Mock } };
  let kernel: { calculateBoqItem: jest.Mock };
  let writer: { persistBoqItemCalculation: jest.Mock };
  let service: RabAutoPriceReadyService;
  beforeEach(() => {
    prisma = { boqItem: { findMany: jest.fn().mockResolvedValue([]) } };
    kernel = {
      calculateBoqItem: jest.fn().mockResolvedValue({
        status: COST_CALCULATION_STATUS.CALCULATED,
        boqItemId: 'row-a',
        unitPrice: '10000',
        lineTotal: '10000',
      }),
    };
    writer = {
      persistBoqItemCalculation: jest.fn().mockResolvedValue({
        boqItemId: 'row-a',
        priceOrigin: 'SERVER_COST_KERNEL',
      }),
    };
    service = new RabAutoPriceReadyService(
      prisma as unknown as PrismaService,
      kernel as unknown as CostKernelService,
      writer as unknown as RabKernelPersistenceService,
    );
  });

  it('persists only an already-linked and kernel-CALCULATED item through one canonical writer', async () => {
    prisma.boqItem.findMany.mockResolvedValue([row('row-a')]);
    const result = await service.execute(input);
    expect(kernel.calculateBoqItem).toHaveBeenCalledWith(
      'row-a',
      input.projectId,
      input.workspaceId,
    );
    expect(writer.persistBoqItemCalculation).toHaveBeenCalledTimes(1);
    expect(writer.persistBoqItemCalculation).toHaveBeenCalledWith({
      projectId: input.projectId,
      boqItemId: 'row-a',
      workspaceId: input.workspaceId,
      calculationAsOfDateRaw: input.calculationAsOfDate,
    });
    expect(result.counts.calculatedAndPersisted).toBe(1);
    expect(result.rabApproved).toBe(false);
    expect(result.rabLocked).toBe(false);
  });

  it('does not write if AHSP missing, price manual, or price already persisted', async () => {
    prisma.boqItem.findMany.mockResolvedValue([
      row('a', { ahspVersionId: null }),
      row('b', { priceOrigin: 'MANUAL_CLIENT' }),
      row('c', { priceOrigin: 'SERVER_COST_KERNEL' }),
    ]);
    const result = await service.execute(input);
    expect(kernel.calculateBoqItem).not.toHaveBeenCalled();
    expect(writer.persistBoqItemCalculation).not.toHaveBeenCalled();
    expect(result.results.map((v) => v.status)).toEqual([
      'UNPRICED',
      'MANUAL_PRICE_PRESERVED',
      'ALREADY_CALCULATED',
    ]);
  });

  it('never treats a fail-closed Cost Kernel output as money', async () => {
    prisma.boqItem.findMany.mockResolvedValue([row('a')]);
    kernel.calculateBoqItem.mockResolvedValue({
      status: COST_CALCULATION_STATUS.FAIL_CLOSED,
      boqItemId: 'a',
      reason: 'MISSING_ADAPTED_PRICE',
    });
    const result = await service.execute(input);
    expect(result.results[0]).toMatchObject({
      status: 'UNPRICED',
      reason: 'MISSING_ADAPTED_PRICE',
    });
    expect(writer.persistBoqItemCalculation).not.toHaveBeenCalled();
  });

  it('isolates a writer revalidation conflict without blocking another lawful line', async () => {
    prisma.boqItem.findMany.mockResolvedValue([row('a'), row('b')]);
    writer.persistBoqItemCalculation
      .mockRejectedValueOnce(new Error('PERSISTED_CONTEXT_CHANGED'))
      .mockResolvedValueOnce({ boqItemId: 'b' });
    const result = await service.execute(input);
    expect(result.results.map((v) => v.status)).toEqual([
      'WRITE_REVALIDATION_REQUIRED',
      'CALCULATED_AND_PERSISTED',
    ]);
    expect(writer.persistBoqItemCalculation).toHaveBeenCalledTimes(2);
  });

  it('bounded queries protect project and workspace and reject invalid pagination', async () => {
    prisma.boqItem.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);
    const result = await service.execute({ ...input, page: '1', limit: '2' });
    expect(result.hasNext).toBe(true);
    const calls = prisma.boqItem.findMany.mock
      .calls as unknown as ReadonlyArray<readonly [unknown]>;
    expect(calls[0]?.[0]).toMatchObject({
      where: {
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId: input.projectId,
          project: { workspaceId: input.workspaceId },
          status: 'DRAFT',
        },
      },
      skip: 0,
      take: 3,
    });
    for (const bad of [{ page: '0' }, { limit: '26' }, { page: 'NaN' }]) {
      await expect(
        service.execute({ ...input, ...bad }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('single RAB-level write command is protected by RAB_DRAFT_EDIT', async () => {
    const controller = new RabAutoPriceReadyController(service);
    const descriptor = Object.getOwnPropertyDescriptor(
      RabAutoPriceReadyController.prototype,
      'execute',
    );
    const method = (descriptor?.value as object | undefined) ?? {};
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual([
      PERMISSIONS.RAB_DRAFT_EDIT,
    ]);
    const response = await controller.execute(
      {
        projectAccess: { workspaceId: input.workspaceId },
      },
      input.projectId,
      { calculationAsOfDate: input.calculationAsOfDate },
    );
    expect(response.rabApproved).toBe(false);
  });
});
