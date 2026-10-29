/**
 * RAB-AUTO-07: full service-chain CONTRACT proof with controlled dependencies.
 * This is NOT a PostgreSQL / authenticated browser E2E proof.
 * Explicit first association -> canonical Cost Kernel -> existing RAB writer.
 */
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAhspService } from './project-ahsp.service';
import { RabAutoFirstBindService } from './rab-auto-first-bind.service';
import { RabAutoPriceReadyService } from '../project/rab-auto-price-ready.service';
import { CostKernelService } from '../project/cost-kernel.service';
import { RabKernelPersistenceService } from '../project/rab-kernel-persistence.service';
import { COST_CALCULATION_STATUS } from '../project/cost-kernel.contracts';

describe('RAB-AUTO-07 contract: SOURCE FACT → AHSP → COST → CANONICAL RAB WRITE', () => {
  const projectId = '10000000-0000-4000-8000-000000000001';
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const accountId = '30000000-0000-4000-8000-000000000001';
  const boqItemId = '40000000-0000-4000-8000-000000000001';
  const ahspVersionId = '50000000-0000-4000-8000-000000000001';
  const regionId = '60000000-0000-4000-8000-000000000001';
  const name = 'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)';
  const date = '2026-10-29';
  const context = {
    projectId,
    workspaceId,
    accountId,
    businessPricingAsOfDate: date,
  };
  const state: {
    sourceAhspCode: string | null;
    ahspVersionId: string | null;
    workingOccurrenceId: string | null;
    calculationOccurrenceId: string | null;
    priceOrigin: string | null;
    unitPrice: string | null;
    lineTotal: string | null;
  } = {
    sourceAhspCode: 'B.64',
    ahspVersionId: null,
    workingOccurrenceId: null,
    calculationOccurrenceId: null,
    priceOrigin: null,
    unitPrice: null,
    lineTotal: null,
  };
  const baseBoq = () => ({
    id: boqItemId,
    name,
    updatedAt: new Date('2026-10-28T11:00:00.000Z'),
    sourceAhspCode: state.sourceAhspCode,
    ahspVersionId: state.ahspVersionId,
    workingOccurrenceId: state.workingOccurrenceId,
    calculationOccurrenceId: state.calculationOccurrenceId,
    priceOrigin: state.priceOrigin,
    unitPrice: state.unitPrice,
    lineTotal: state.lineTotal,
  });
  let first: RabAutoFirstBindService;
  let price: RabAutoPriceReadyService;
  let nativeWriter: { persistBoqItemCalculation: jest.Mock };
  let nativeCost: { calculateBoqItem: jest.Mock };
  let selection: {
    searchEligibleVersions: jest.Mock;
    selectForBoqItem: jest.Mock;
  };

  beforeEach(() => {
    Object.assign(state, {
      sourceAhspCode: 'B.64',
      ahspVersionId: null,
      workingOccurrenceId: null,
      calculationOccurrenceId: null,
      priceOrigin: null,
      unitPrice: null,
      lineTotal: null,
    });
    selection = {
      searchEligibleVersions: jest.fn().mockResolvedValue({
        hasNext: false,
        items: [
          {
            id: ahspVersionId,
            ahsp: {
              code: 'B.64',
              workType: 'Saluran U Pracetak',
              methodName: name,
            },
            preference: { recommended: true },
          },
        ],
      }),
      selectForBoqItem: jest.fn().mockImplementation(() => {
        state.ahspVersionId = ahspVersionId;
        state.workingOccurrenceId = 'proven-occurrence';
        return { id: 'proven-occurrence' };
      }),
    };
    const firstPrisma = {
      boqStructure: {
        findMany: jest.fn().mockResolvedValue([{ id: 'working-draft' }]),
      },
      boqBusinessUseEvent: {
        findFirst: jest.fn().mockResolvedValue({
          usedAt: new Date('2026-10-28T12:00:00.000Z'),
        }),
      },
      projectRegionSelection: {
        findMany: jest.fn().mockResolvedValue([{ regionId }]),
      },
      boqItem: {
        findMany: jest.fn().mockImplementation(() => [baseBoq()]),
      },
    };
    first = new RabAutoFirstBindService(
      firstPrisma as unknown as PrismaService,
      selection as unknown as ProjectAhspService,
    );

    nativeCost = {
      calculateBoqItem: jest.fn().mockResolvedValue({
        boqItemId,
        status: COST_CALCULATION_STATUS.CALCULATED,
        unitPrice: '50000',
        lineTotal: '75000',
      }),
    };
    nativeWriter = {
      persistBoqItemCalculation: jest.fn().mockImplementation(() => {
        state.workingOccurrenceId = null;
        state.calculationOccurrenceId = 'frozen-occurrence';
        state.priceOrigin = 'SERVER_COST_KERNEL';
        state.unitPrice = '50000';
        state.lineTotal = '75000';
        return { boqItemId, priceOrigin: state.priceOrigin };
      }),
    };
    const pricePrisma = {
      boqItem: {
        findMany: jest.fn().mockImplementation(() => [baseBoq()]),
      },
    };
    price = new RabAutoPriceReadyService(
      pricePrisma as unknown as PrismaService,
      nativeCost as unknown as CostKernelService,
      nativeWriter as unknown as RabKernelPersistenceService,
    );
  });

  it('links verified AHSP once, calls the native Cost Kernel, freezes via existing writer, and rereads frozen data', async () => {
    const linked = await first.execute(context);
    expect(linked.summary).toEqual({ FIRST_ASSOCIATION_PROVEN_AND_LINKED: 1 });
    expect(selection.selectForBoqItem).toHaveBeenCalledTimes(1);

    const computed = await price.execute({
      projectId,
      workspaceId,
      calculationAsOfDate: date,
    });
    expect(computed.counts).toMatchObject({ calculatedAndPersisted: 1 });
    expect(nativeCost.calculateBoqItem).toHaveBeenCalledWith(
      boqItemId,
      projectId,
      workspaceId,
    );
    expect(nativeWriter.persistBoqItemCalculation).toHaveBeenCalledWith({
      boqItemId,
      projectId,
      workspaceId,
      calculationAsOfDateRaw: date,
    });
    const readAgain = baseBoq();
    expect(readAgain).toMatchObject({
      ahspVersionId,
      calculationOccurrenceId: 'frozen-occurrence',
      workingOccurrenceId: null,
      priceOrigin: 'SERVER_COST_KERNEL',
      unitPrice: '50000',
      lineTotal: '75000',
    });
    const repeat = await price.execute({
      projectId,
      workspaceId,
      calculationAsOfDate: date,
    });
    expect(repeat.results[0].status).toBe('ALREADY_CALCULATED');
    expect(nativeWriter.persistBoqItemCalculation).toHaveBeenCalledTimes(1);
  });

  it('never calculates a BOQ whose source has no explicitly approved AHSP code', async () => {
    state.sourceAhspCode = null;
    const result = await first.execute(context);
    expect(result.summary).toEqual({ EXPLICIT_SOURCE_REFERENCE_MISSING: 1 });
    expect(selection.selectForBoqItem).not.toHaveBeenCalled();

    const computed = await price.execute({
      projectId,
      workspaceId,
      calculationAsOfDate: date,
    });
    expect(computed.counts.unpriced).toBe(1);
    expect(nativeCost.calculateBoqItem).not.toHaveBeenCalled();
    expect(nativeWriter.persistBoqItemCalculation).not.toHaveBeenCalled();
    expect(state.lineTotal).toBeNull();
  });

  it('never guesses a region or produces money when project selection is ambiguous', async () => {
    const prisma = {
      boqStructure: {
        findMany: jest.fn().mockResolvedValue([{ id: 'working-draft' }]),
      },
      boqBusinessUseEvent: {
        findFirst: jest.fn().mockResolvedValue({
          usedAt: new Date('2026-10-28T12:00:00.000Z'),
        }),
      },
      projectRegionSelection: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ regionId }, { regionId: 'other' }]),
      },
      boqItem: { findMany: jest.fn().mockResolvedValue([baseBoq()]) },
    };
    first = new RabAutoFirstBindService(
      prisma as unknown as PrismaService,
      selection as unknown as ProjectAhspService,
    );
    const result = await first.execute(context);
    expect(result.summary).toEqual({ PRICE_REGION_NOT_UNIQUE: 1 });
    expect(selection.selectForBoqItem).not.toHaveBeenCalled();
    expect(nativeWriter.persistBoqItemCalculation).not.toHaveBeenCalled();
  });
});
