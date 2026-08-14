import 'reflect-metadata';
import { PersistedCalculationService } from './persisted-calculation.service';
import { CostKernelService } from './cost-kernel.service';
import { PrismaService } from '../prisma/prisma.service';
import { COST_CALCULATION_REASON, COST_CALCULATION_STATUS } from './cost-kernel.contracts';
import {
  PERSISTED_CALCULATION_REASON,
  PERSISTED_CALCULATION_STATUS,
} from './persisted-calculation.contracts';

/**
 * RM-03 read-only re-proof.
 *
 * The fixture below is the SAME frozen 13-resource set used by
 * cost-kernel.service.spec.ts, so the expected money here (2004055 per unit,
 * x10 volume) is the value the existing certified kernel already produces.
 * Reusing it deliberately: if this service ever drifts from the kernel, these
 * numbers stop agreeing with the other spec's numbers and both fail.
 *
 * Two properties are proven here that no existing spec covers:
 *   1. a line whose workingOccurrenceId has been cleared by a successful
 *      persist is STILL re-provable through calculationOccurrenceId, which is
 *      exactly the state a hard reload lands in; and
 *   2. this path is strictly read-only — the guarded Proxy throws if any
 *      Prisma model outside {boqItem, projectAhspOccurrence} is touched, and
 *      the model handlers expose no write method at all, so a stray
 *      update/create would throw rather than silently repair a row.
 */

const FIXTURE_LABELS = [
  'TEST_ONLY_SYNTHETIC_FIXTURE',
  'PRODUCTION_TRUTH_NO',
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
  'OH', 'OH', 'OH', 'OH', 'OH',
  'm3', 'm3', 'Kg', 'Kg', 'Kg', 'Kg', 'Liter', 'Liter',
];

const COEFFICIENTS = [
  '0.600000', '0.200000', '0.200000', '0.040000', '0.013000',
  '0.038700', '0.039600', '0.587200', '26.406000', '61.560000',
  '83.349000', '17.415000', '0.400000',
];

const ADAPTED_PRICES = [
  '100000.00', '100000.00', '100000.00', '120000.00', '100000.00',
  '10000.00', '10000.00', '10000.00', '10000.00', '10000.00',
  '10000.00', '10000.00', '10000.00',
];

const PROJECT_ID = 'proj-fixture';
const WORKSPACE_ID = 'ws-fixture';
const AHSP_VERSION_ID = 'ahsp-version-fixture';
const OCCURRENCE_ID = 'occurrence-fixture';
const BOQ_ITEM_ID = 'boq-item-fixture';
const REGION_ID = 'region-fixture';

/** The exact values the certified kernel produces for this fixture at volume 10. */
const EXPECTED_UNIT_PRICE = '2004055.00';
const EXPECTED_LINE_TOTAL = '20040550.00';

const buildResourceResolutions = (
  overrides: { statuses?: string[]; adaptedPrices?: (string | null)[] } = {},
) =>
  RESOURCE_NAMES.map((name, index) => {
    const adapted = (overrides.adaptedPrices ?? ADAPTED_PRICES)[index];
    return {
      id: `resolution-${index}`,
      ahspResourceId: `resource-${index}`,
      rawAhspResourceRef: name,
      rawAhspResourceType: index < 5 ? 'LABOR' : 'MATERIAL',
      resourceCatalogId: `catalog-${index}`,
      resolvedCatalog: { name },
      ahspCoefficient: { toString: () => COEFFICIENTS[index] },
      ahspUnit: RESOURCE_UNITS[index],
      selectedBasicPriceId: `basic-price-${index}`,
      sourcePriceValue: adapted === null ? null : { toString: () => adapted },
      sourceUnit: RESOURCE_UNITS[index],
      adaptedPriceValue: adapted === null ? null : { toString: () => adapted },
      canonicalUnit: index < 5 ? 'PERSON_DAY' : null,
      quantityFactor: { toString: () => '1' },
      selectedSourceOrigin: 'SUPPLIER',
      selectedFreshnessStatus: 'CURRENT',
      selectedEffectiveDate: new Date('2026-01-15T00:00:00.000Z'),
      status: (overrides.statuses ?? [])[index] ?? 'RESOLVED',
      resolutionMethod: 'EXACT_DETERMINISTIC',
      reasonCodes: ['EXACT_RESOURCE_NAME_MATCH', 'SINGLE_ELIGIBLE_BASIC_PRICE'],
      explanation: 'deterministic fixture resolution',
      policyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
      originalResource: { ahspVersionId: AHSP_VERSION_ID },
    };
  });

const buildOccurrence = (
  overrides: {
    statuses?: string[];
    adaptedPrices?: (string | null)[];
    ahspOwnershipAtCalculation?: string | null;
  } = {},
) => ({
  id: OCCURRENCE_ID,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  ahspVersionId: AHSP_VERSION_ID,
  generation: 1,
  resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
  referenceRegionId: REGION_ID,
  referenceRegion: { name: 'Kota Fixture' },
  /**
   * RAB-TRUTH-01H — the AHSP ownership FROZEN when this calculation context was
   * created. The live AHSP row is deliberately never consulted by the re-proof
   * path, which is why the guarded Prisma proxy below does not even allow an
   * `ahsp` model read.
   */
  ahspOwnershipAtCalculation:
    overrides.ahspOwnershipAtCalculation === undefined
      ? 'USER_ASSET'
      : overrides.ahspOwnershipAtCalculation,
  resourceResolutions: buildResourceResolutions(overrides),
});

/**
 * A line as it exists AFTER a successful persist: workingOccurrenceId is
 * null (the persist command cleared it) and calculationOccurrenceId carries
 * the surviving provenance. This is the post-hard-reload state.
 */
const buildPersistedBoqItem = (overrides: Record<string, unknown> = {}) => ({
  id: BOQ_ITEM_ID,
  itemType: 'WORK_ITEM',
  quantity: { toString: () => '10' },
  unit: 'M1',
  unitPrice: EXPECTED_UNIT_PRICE,
  lineTotal: EXPECTED_LINE_TOTAL,
  ahspVersionId: AHSP_VERSION_ID,
  workingOccurrenceId: null,
  priceOrigin: 'SERVER_COST_KERNEL',
  calculationOccurrenceId: OCCURRENCE_ID,
  calculationAsOfDate: new Date('2026-02-01T00:00:00.000Z'),
  calculatedAt: new Date('2026-02-01T09:30:00.000Z'),
  calculationPolicyVersion: 'GATE2A_RAB_KERNEL_PERSISTENCE_V1',
  ahspVersion: { outputUnit: 'M1' },
  boqStructure: {
    projectId: PROJECT_ID,
    project: { workspaceId: WORKSPACE_ID },
  },
  ...overrides,
});

const ALLOWED_MODELS = new Set(['boqItem', 'projectAhspOccurrence']);

function createGuardedPrisma(options: {
  boqItem?: ReturnType<typeof buildPersistedBoqItem> | null;
  occurrence?: ReturnType<typeof buildOccurrence> | null;
}) {
  const accessedModels = new Set<string>();
  const boqItemFindFirst = jest.fn().mockResolvedValue(options.boqItem ?? null);
  const occurrenceFindFirst = jest
    .fn()
    .mockResolvedValue(options.occurrence ?? null);

  // Read-only surface by construction: no update/create/delete/upsert key
  // exists on either handler, so any write attempt is a TypeError, not a
  // silently-tolerated no-op.
  const modelHandlers: Record<string, unknown> = {
    boqItem: { findFirst: boqItemFindFirst },
    projectAhspOccurrence: { findFirst: occurrenceFindFirst },
  };

  const prisma = new Proxy(
    {},
    {
      get(_target, prop) {
        const key = String(prop);
        accessedModels.add(key);
        if (!ALLOWED_MODELS.has(key)) {
          throw new Error(
            `PersistedCalculationService touched an unexpected Prisma model "${key}" — ` +
              'the re-proof path may read only boqItem and projectAhspOccurrence.',
          );
        }
        return modelHandlers[key];
      },
    },
  ) as unknown as PrismaService;

  return { prisma, boqItemFindFirst, occurrenceFindFirst, accessedModels };
}

describe('PersistedCalculationService — RM-03 read-only re-proof', () => {
  it('is labelled as synthetic, non-production fixture data', () => {
    expect(FIXTURE_LABELS).toEqual([
      'TEST_ONLY_SYNTHETIC_FIXTURE',
      'PRODUCTION_TRUTH_NO',
    ]);
  });

  it('depends on PrismaService only — no pricing resolver is reachable from this path', () => {
    const paramTypes = (Reflect.getMetadata(
      'design:paramtypes',
      PersistedCalculationService,
    ) ?? []) as unknown[];
    expect(paramTypes).toHaveLength(1);
    expect(paramTypes[0]).toBe(PrismaService);
  });

  it('re-proves a persisted line whose workingOccurrenceId was cleared, reproducing stored money exactly', async () => {
    const { prisma, occurrenceFindFirst, accessedModels } = createGuardedPrisma({
      boqItem: buildPersistedBoqItem(),
      occurrence: buildOccurrence(),
    });
    const service = new PersistedCalculationService(prisma);

    const result = await service.getPersistedCalculation(
      BOQ_ITEM_ID,
      PROJECT_ID,
      WORKSPACE_ID,
    );

    expect(result).toMatchObject({
      status: PERSISTED_CALCULATION_STATUS.VERIFIED,
      priceOrigin: 'SERVER_COST_KERNEL',
      stored: { unitPrice: EXPECTED_UNIT_PRICE, lineTotal: EXPECTED_LINE_TOTAL },
      recomputed: {
        unitPrice: EXPECTED_UNIT_PRICE,
        lineTotal: EXPECTED_LINE_TOTAL,
      },
      integrity: {
        unitPriceMatches: true,
        lineTotalMatches: true,
        allResourceCostsReproduced: true,
      },
    });
    // The occurrence must be fetched by the CALCULATION pointer, tenant-scoped.
    expect(occurrenceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: OCCURRENCE_ID,
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
        },
      }),
    );
    expect(accessedModels).toEqual(
      new Set(['boqItem', 'projectAhspOccurrence']),
    );
  });

  it('is the counterpart CostKernelService cannot serve: the same persisted line fails there as OCCURRENCE_NOT_FOUND', async () => {
    // Proves the gap this service closes is real, not hypothetical.
    const costKernelPrisma = new Proxy(
      {},
      {
        get(_target, prop) {
          const key = String(prop);
          if (key === 'boqItem') {
            return { findFirst: jest.fn().mockResolvedValue(buildPersistedBoqItem()) };
          }
          return { findMany: jest.fn().mockResolvedValue([]) };
        },
      },
    ) as unknown as PrismaService;

    const costKernelResult = await new CostKernelService(
      costKernelPrisma,
    ).calculateBoqItem(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID);

    expect(costKernelResult).toMatchObject({
      status: COST_CALCULATION_STATUS.FAIL_CLOSED,
      reason: COST_CALCULATION_REASON.OCCURRENCE_NOT_FOUND,
    });
  });

  it('returns each resource cost as exact coefficient x adapted price, with its Basic Price provenance', async () => {
    const { prisma } = createGuardedPrisma({
      boqItem: buildPersistedBoqItem(),
      occurrence: buildOccurrence(),
    });
    const service = new PersistedCalculationService(prisma);

    const result = await service.getPersistedCalculation(
      BOQ_ITEM_ID,
      PROJECT_ID,
      WORKSPACE_ID,
    );
    if (result.status === PERSISTED_CALCULATION_STATUS.FAIL_CLOSED) {
      throw new Error(`expected a re-proof, got ${result.reason}`);
    }

    expect(result.resources).toHaveLength(13);
    // 0.6 x 100000 = 60000 exactly.
    expect(result.resources[0]).toMatchObject({
      rawAhspResourceRef: 'Pekerja',
      coefficient: '0.600000',
      adaptedPriceValue: '100000.00',
      resourceCost: '60000',
      selectedBasicPriceId: 'basic-price-0',
      selectedEffectiveDate: '2026-01-15',
      status: 'RESOLVED',
    });
    // 26.406 x 10000 = 264060 exactly.
    expect(result.resources[8]).toMatchObject({
      rawAhspResourceRef: 'Semen Portland',
      coefficient: '26.406000',
      resourceCost: '264060',
    });
    expect(result.provenance).toMatchObject({
      calculationOccurrenceId: OCCURRENCE_ID,
      ahspVersionId: AHSP_VERSION_ID,
      calculationAsOfDate: '2026-02-01',
      calculationPolicyVersion: 'GATE2A_RAB_KERNEL_PERSISTENCE_V1',
      resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1',
      referenceRegionName: 'Kota Fixture',
      occurrenceGeneration: 1,
    });
  });

  it('reports MISMATCH rather than silently trusting or repairing a tampered stored unit price', async () => {
    const { prisma } = createGuardedPrisma({
      boqItem: buildPersistedBoqItem({ unitPrice: '1999999.00' }),
      occurrence: buildOccurrence(),
    });
    const service = new PersistedCalculationService(prisma);

    const result = await service.getPersistedCalculation(
      BOQ_ITEM_ID,
      PROJECT_ID,
      WORKSPACE_ID,
    );

    expect(result).toMatchObject({
      status: PERSISTED_CALCULATION_STATUS.MISMATCH,
      stored: { unitPrice: '1999999.00' },
      recomputed: { unitPrice: EXPECTED_UNIT_PRICE },
      integrity: { unitPriceMatches: false, lineTotalMatches: true },
    });
  });

  it('fails closed when a frozen resolution is not RESOLVED, carrying the kernel reason', async () => {
    const statuses = [...Array(13)].map(() => 'RESOLVED');
    statuses[4] = 'NEEDS_REVIEW';
    const { prisma } = createGuardedPrisma({
      boqItem: buildPersistedBoqItem(),
      occurrence: buildOccurrence({ statuses }),
    });
    const service = new PersistedCalculationService(prisma);

    expect(
      await service.getPersistedCalculation(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID),
    ).toMatchObject({
      status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
      reason: PERSISTED_CALCULATION_REASON.RECOMPUTATION_FAIL_CLOSED,
      kernelReason: COST_CALCULATION_REASON.UNRESOLVED_RESOURCE,
    });
  });

  it.each([
    [
      'an unpriced row',
      { priceOrigin: null, unitPrice: null, lineTotal: null, calculationOccurrenceId: null },
      PERSISTED_CALCULATION_REASON.NOT_CALCULATED,
    ],
    [
      'a human-typed row',
      { priceOrigin: 'MANUAL_CLIENT', calculationOccurrenceId: null },
      PERSISTED_CALCULATION_REASON.MANUAL_PRICE_NOT_REPROVABLE,
    ],
  ])('refuses to re-prove %s', async (_label, overrides, expectedReason) => {
    const { prisma } = createGuardedPrisma({
      boqItem: buildPersistedBoqItem(overrides),
      occurrence: buildOccurrence(),
    });
    const service = new PersistedCalculationService(prisma);

    expect(
      await service.getPersistedCalculation(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID),
    ).toMatchObject({
      status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
      reason: expectedReason,
    });
  });

  it('fails closed when the cited occurrence is unreachable in this tenant', async () => {
    const { prisma } = createGuardedPrisma({
      boqItem: buildPersistedBoqItem(),
      occurrence: null,
    });
    const service = new PersistedCalculationService(prisma);

    expect(
      await service.getPersistedCalculation(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID),
    ).toMatchObject({
      status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
      reason: PERSISTED_CALCULATION_REASON.CALCULATION_OCCURRENCE_MISSING,
    });
  });

  it('scopes the BoqItem read to the project AND the workspace, and reports a foreign row as not found', async () => {
    const { prisma, boqItemFindFirst } = createGuardedPrisma({ boqItem: null });
    const service = new PersistedCalculationService(prisma);

    expect(
      await service.getPersistedCalculation(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID),
    ).toMatchObject({
      status: PERSISTED_CALCULATION_STATUS.FAIL_CLOSED,
      reason: PERSISTED_CALCULATION_REASON.BOQ_ITEM_NOT_FOUND,
    });
    expect(boqItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: BOQ_ITEM_ID,
          boqStructure: {
            projectId: PROJECT_ID,
            project: { workspaceId: WORKSPACE_ID },
          },
        },
      }),
    );
  });

  /**
   * RAB-TRUTH-01H — HISTORICAL PRICE ORIGIN DOES NOT DRIFT.
   *
   * A price origin says how a price WAS FORMED, not who owns the source today.
   * These pin the freeze end to end: the answer comes from the occurrence, the
   * live AHSP row is never consulted, and an unproven history stays unproven
   * rather than being filled in from the present.
   */
  describe('source authority is frozen at calculation time', () => {
    it('reports the ownership recorded on the occurrence, whatever the AHSP is today', async () => {
      const { prisma, accessedModels } = createGuardedPrisma({
        boqItem: buildPersistedBoqItem(),
        occurrence: buildOccurrence({ ahspOwnershipAtCalculation: 'USER_ASSET' }),
      });
      const service = new PersistedCalculationService(prisma as never);

      const result = await service.getPersistedCalculation(
        BOQ_ITEM_ID,
        PROJECT_ID,
        WORKSPACE_ID,
      );

      expect(result).toMatchObject({
        sourceAuthority: { ahspOwnership: 'USER_ASSET', ahspAuthoritative: false },
      });
      // The live AHSP row is not even read — there is nothing to drift with.
      expect(accessedModels.has('ahsp')).toBe(false);
      expect(accessedModels.has('aHSP')).toBe(false);
    });

    it('a NEW calculation frozen after a transfer truthfully reports the new authority', async () => {
      // Same row, same shape — only the frozen fact differs, which is exactly
      // what a recalculation after a lawful transfer would record.
      const { prisma } = createGuardedPrisma({
        boqItem: buildPersistedBoqItem(),
        occurrence: buildOccurrence({ ahspOwnershipAtCalculation: 'SIMPROK_ASSET' }),
      });
      const service = new PersistedCalculationService(prisma as never);

      expect(
        await service.getPersistedCalculation(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID),
      ).toMatchObject({
        sourceAuthority: { ahspOwnership: 'SIMPROK_ASSET', ahspAuthoritative: true },
      });
    });

    it('an approved community asset is authoritative too', async () => {
      const { prisma } = createGuardedPrisma({
        boqItem: buildPersistedBoqItem(),
        occurrence: buildOccurrence({
          ahspOwnershipAtCalculation: 'APPROVED_COMMUNITY_ASSET',
        }),
      });
      const service = new PersistedCalculationService(prisma as never);

      expect(
        await service.getPersistedCalculation(BOQ_ITEM_ID, PROJECT_ID, WORKSPACE_ID),
      ).toMatchObject({ sourceAuthority: { ahspAuthoritative: true } });
    });

    /**
     * UNKNOWN IS ITS OWN ANSWER. `false` would mean "proven user asset", which
     * the reader turns into "Data Pengguna" — a claim about whose data formed
     * the price. When the historical ownership was never recorded, the wire
     * carries `null` so the reader can say so instead.
     */
    it('an unproven history reports null, not false — unknown is not user data', async () => {
      const { prisma } = createGuardedPrisma({
        boqItem: buildPersistedBoqItem(),
        occurrence: buildOccurrence({ ahspOwnershipAtCalculation: null }),
      });
      const service = new PersistedCalculationService(prisma as never);

      const result = await service.getPersistedCalculation(
        BOQ_ITEM_ID,
        PROJECT_ID,
        WORKSPACE_ID,
      );

      expect(result).toMatchObject({
        sourceAuthority: { ahspOwnership: null, ahspAuthoritative: null },
      });
      // Explicitly NOT false — that is the collapse this test exists to stop.
      expect(
        (result as { sourceAuthority: { ahspAuthoritative: unknown } })
          .sourceAuthority.ahspAuthoritative,
      ).not.toBe(false);
    });
  });
});
