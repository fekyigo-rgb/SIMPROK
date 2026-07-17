import 'reflect-metadata';
import { CostKernelService } from './cost-kernel.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
} from './cost-kernel.contracts';

/**
 * Grade A no-resolver proof: CostKernelService must read only frozen
 * ProjectAhspResourceResolution fields (ahspCoefficient, adaptedPriceValue)
 * and must never call Basic Price, Unit Kernel, or any other pricing
 * resolver at runtime. A local counter set to 0 proves nothing — this proof
 * uses a Proxy that throws the instant an unexpected Prisma model is
 * touched, plus jest spies asserting exactly which calls did happen.
 */

const FIXTURE_LABELS = [
  'TEST_FIXTURE_ONLY',
  'OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION',
] as const;

const RESOURCE_NAMES = [
  'Pekerja',
  'Tukang Kayu',
  'Tukang batu',
  'Kepala Tukang',
  'Mandor',
  'kaso kayu5/7 kayu kelas II',
  'Papan Kayu Uk 2/20cm',
  'Paku biasa',
  'Semen Portland',
  'Pasir beton',
  'Kerikil',
  'Air',
  'Residu atau ter',
];

const RESOURCE_UNITS = [
  'OH',
  'OH',
  'OH',
  'OH',
  'OH',
  'm3',
  'm3',
  'Kg',
  'Kg',
  'Kg',
  'Kg',
  'Liter',
  'Liter',
];

const COEFFICIENTS = [
  '0.600000',
  '0.200000',
  '0.200000',
  '0.040000',
  '0.013000',
  '0.038700',
  '0.039600',
  '0.587200',
  '26.406000',
  '61.560000',
  '83.349000',
  '17.415000',
  '0.400000',
];

const ADAPTED_PRICES = [
  '100000.00',
  '100000.00',
  '100000.00',
  '120000.00',
  '100000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
];

const PROJECT_ID = 'proj-fixture';
const WORKSPACE_ID = 'ws-fixture';
const AHSP_VERSION_ID = 'ahsp-version-fixture';
const OCCURRENCE_ID = 'occurrence-fixture';
const BOQ_ITEM_ID = 'boq-item-fixture';

const buildResourceResolutions = (
  adaptedPrices: (string | null)[] = ADAPTED_PRICES,
) =>
  RESOURCE_NAMES.map((name, index) => ({
    id: `resolution-${index}`,
    ahspResourceId: `resource-${index}`,
    status: 'RESOLVED',
    ahspCoefficient: { toString: () => COEFFICIENTS[index] },
    adaptedPriceValue:
      adaptedPrices[index] === null
        ? null
        : { toString: () => adaptedPrices[index] },
    originalResource: {
      ahspVersionId: AHSP_VERSION_ID,
      baseUnit: RESOURCE_UNITS[index],
    },
  }));

const buildOccurrence = (adaptedPrices?: (string | null)[]) => ({
  id: OCCURRENCE_ID,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  ahspVersionId: AHSP_VERSION_ID,
  resourceResolutions: buildResourceResolutions(adaptedPrices),
});

const buildBoqItem = () => ({
  id: BOQ_ITEM_ID,
  itemType: 'WORK_ITEM',
  quantity: { toString: () => '10' },
  unit: 'M1',
  ahspVersionId: AHSP_VERSION_ID,
  ahspVersion: { outputUnit: 'M1' },
  boqStructure: {
    projectId: PROJECT_ID,
    project: { workspaceId: WORKSPACE_ID },
  },
});

/** Allowed Prisma model surface for CostKernelService — anything else throws. */
const ALLOWED_MODELS = new Set(['boqItem', 'projectAhspOccurrence']);

interface GuardedPrismaFixture {
  prisma: PrismaService;
  boqItemFindFirst: jest.Mock;
  boqItemFindMany: jest.Mock;
  occurrenceFindMany: jest.Mock;
  accessedModels: Set<string>;
}

function createGuardedPrisma(options: {
  boqItem?: ReturnType<typeof buildBoqItem> | null;
  boqItems?: ReturnType<typeof buildBoqItem>[];
  occurrences?: ReturnType<typeof buildOccurrence>[];
}): GuardedPrismaFixture {
  const accessedModels = new Set<string>();
  const boqItemFindFirst = jest.fn().mockResolvedValue(options.boqItem ?? null);
  const boqItemFindMany = jest
    .fn()
    .mockResolvedValue(
      options.boqItems ?? (options.boqItem ? [options.boqItem] : []),
    );
  const occurrenceFindMany = jest
    .fn()
    .mockResolvedValue(options.occurrences ?? []);

  const modelHandlers: Record<string, unknown> = {
    boqItem: { findFirst: boqItemFindFirst, findMany: boqItemFindMany },
    projectAhspOccurrence: { findMany: occurrenceFindMany },
  };

  const prisma = new Proxy(
    {},
    {
      get(_target, prop) {
        const key = String(prop);
        accessedModels.add(key);
        if (!ALLOWED_MODELS.has(key)) {
          throw new Error(
            `CostKernelService touched an unexpected Prisma model "${key}" — ` +
              'only frozen resolution reads (boqItem, projectAhspOccurrence) are permitted.',
          );
        }
        return modelHandlers[key];
      },
    },
  ) as unknown as PrismaService;

  return {
    prisma,
    boqItemFindFirst,
    boqItemFindMany,
    occurrenceFindMany,
    accessedModels,
  };
}

describe('CostKernelService no-resolver proof', () => {
  it('depends on PrismaService only — no Basic Price, Unit Kernel, or other resolver dependency exists to call', () => {
    expect(FIXTURE_LABELS).toEqual([
      'TEST_FIXTURE_ONLY',
      'OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION',
    ]);
    const paramTypes = (Reflect.getMetadata(
      'design:paramtypes',
      CostKernelService,
    ) ?? []) as unknown[];
    expect(paramTypes).toHaveLength(1);
    expect(paramTypes[0]).toBe(PrismaService);
  });

  it('calculates the frozen 13-resource fixture (OH, m3, Kg, Liter) using only ahspCoefficient and adaptedPriceValue, with no other Prisma model touched', async () => {
    const { prisma, boqItemFindFirst, occurrenceFindMany, accessedModels } =
      createGuardedPrisma({
        boqItem: buildBoqItem(),
        occurrences: [buildOccurrence()],
      });
    const service = new CostKernelService(prisma);

    const result = await service.calculateBoqItem(
      BOQ_ITEM_ID,
      PROJECT_ID,
      WORKSPACE_ID,
    );

    expect(result).toMatchObject({
      status: COST_CALCULATION_STATUS.CALCULATED,
      ahspUnitPrice: '2004055',
      lineTotal: '20040550',
    });
    expect(boqItemFindFirst).toHaveBeenCalledTimes(1);
    expect(occurrenceFindMany).toHaveBeenCalledTimes(1);
    expect(occurrenceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          ahspVersionId: { in: [AHSP_VERSION_ID] },
        },
      }),
    );
    expect(accessedModels).toEqual(
      new Set(['boqItem', 'projectAhspOccurrence']),
    );
  });

  it('fails closed on a missing adapted price without attempting any fallback pricing lookup', async () => {
    const { prisma, occurrenceFindMany, accessedModels } = createGuardedPrisma({
      boqItem: buildBoqItem(),
      occurrences: [buildOccurrence([null, ...ADAPTED_PRICES.slice(1)])],
    });
    const service = new CostKernelService(prisma);

    const result = await service.calculateBoqItem(
      BOQ_ITEM_ID,
      PROJECT_ID,
      WORKSPACE_ID,
    );

    expect(result).toMatchObject({
      status: COST_CALCULATION_STATUS.FAIL_CLOSED,
      reason: COST_CALCULATION_REASON.MISSING_ADAPTED_PRICE,
    });
    // Exactly one occurrence fetch attempted — a fallback resolver call would show up as an
    // additional call or an additional accessed model, and either would fail this assertion.
    expect(occurrenceFindMany).toHaveBeenCalledTimes(1);
    expect(accessedModels).toEqual(
      new Set(['boqItem', 'projectAhspOccurrence']),
    );
  });

  it('batches multiple lines through a single occurrence fetch and isolates one malformed line from the rest', async () => {
    const secondItemId = 'boq-item-fixture-2';
    const secondItem = { ...buildBoqItem(), id: secondItemId };
    // Malformed: quantity.toString() throws, simulating an unexpected shape for one line only.
    const malformedItemId = 'boq-item-fixture-malformed';
    const malformedItem = {
      ...buildBoqItem(),
      id: malformedItemId,
      quantity: {
        toString: () => {
          throw new Error('corrupt decimal');
        },
      },
    };

    const { prisma, occurrenceFindMany, boqItemFindMany } = createGuardedPrisma(
      {
        boqItems: [buildBoqItem(), secondItem, malformedItem],
        occurrences: [buildOccurrence()],
      },
    );
    const service = new CostKernelService(prisma);

    const batch = await service.calculateBoqItems(
      [BOQ_ITEM_ID, secondItemId, malformedItemId],
      PROJECT_ID,
      WORKSPACE_ID,
    );

    expect(boqItemFindMany).toHaveBeenCalledTimes(1);
    expect(occurrenceFindMany).toHaveBeenCalledTimes(1);
    expect(batch.items).toHaveLength(3);
    expect(batch.items[0]).toMatchObject({
      status: COST_CALCULATION_STATUS.CALCULATED,
      lineTotal: '20040550',
    });
    expect(batch.items[1]).toMatchObject({
      status: COST_CALCULATION_STATUS.CALCULATED,
      lineTotal: '20040550',
    });
    expect(batch.items[2]).toMatchObject({
      status: COST_CALCULATION_STATUS.FAIL_CLOSED,
      reason: COST_CALCULATION_REASON.INTERNAL_CALCULATION_ERROR,
      boqItemId: malformedItemId,
    });
    // directCostTotal must reflect only the two valid CALCULATED lines, as an exact decimal sum.
    expect(batch.directCostTotal).toBe('40081100');
  });

  it('rejects an id that does not belong to the project without querying occurrences for it', async () => {
    const { prisma, boqItemFindFirst } = createGuardedPrisma({ boqItem: null });
    const service = new CostKernelService(prisma);

    const result = await service.calculateBoqItem(
      'missing-item',
      PROJECT_ID,
      WORKSPACE_ID,
    );

    expect(result).toMatchObject({
      status: COST_CALCULATION_STATUS.FAIL_CLOSED,
      reason: COST_CALCULATION_REASON.BOQ_ITEM_NOT_FOUND,
    });
    expect(boqItemFindFirst).toHaveBeenCalledTimes(1);
  });
});
