import { Prisma } from '@prisma/client';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { calculateCostKernel } from '../project/cost-kernel.kernel';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';

/**
 * J.74 readiness proof. All prices, unit rules and Region rows BELOW are
 * in-memory test fixtures, NOT claims of an existing Basic Price for Jakarta.
 *
 * The 7 effective working hours are documented in Permen PUPR 8/2023
 * section 5.2.1.6-5.2.1.7. This test does NOT promote a conversion rule:
 * that remains a separately governed canonical UnitKernel data decision.
 *
 * Only reuses the actual UnitKernel, AHSP orchestrator, Basic Price selection
 * and Cost Kernel. No database connection, mutation, or mock calculator.
 */
const CITY = 'jakarta-pusat-fixture';
const PROVINCE = 'dki-jakarta-fixture';
const SIDEWAYS = 'pancoran-jakarta-selatan-fixture';
const PERSON_DAY = { id: 'person-day-fixture', code: 'PERSON_DAY', dimension: 'PERSON_TIME' };
const PERSON_HOUR = { id: 'person-hour-fixture', code: 'PERSON_HOUR', dimension: 'PERSON_TIME' };

const labor = [
  { id: '925d41fa-674d-4e6a-b18f-839f3046360d', name: 'Mandor', coefficient: '0.083300' },
  { id: 'cb50aeab-c464-4408-9942-cedb552aefc6', name: 'Pekerja', coefficient: '0.333300' },
] as const;

const hierarchy: Record<string, { id: string; parentId: string | null; administrativeLevel: string; isActive: boolean; name: string; code: string }> = {
  [CITY]: { id: CITY, parentId: PROVINCE, administrativeLevel: 'REGENCY_CITY', isActive: true, name: 'Kota Administrasi Jakarta Pusat', code: '31.71' },
  [PROVINCE]: { id: PROVINCE, parentId: null, administrativeLevel: 'PROVINCE', isActive: true, name: 'DKI Jakarta', code: '31' },
  [SIDEWAYS]: { id: SIDEWAYS, parentId: null, administrativeLevel: 'DISTRICT', isActive: true, name: 'Pancoran', code: '31.74.08' },
};

async function prove(opts: {
  name: 'Mandor' | 'Pekerja';
  hasRule: boolean;
  priceRegion?: string;
}) {
  const component = labor.find((x) => x.name === opts.name)!;
  const catalog = {
    id: component.id, name: component.name, code: null, type: 'LABOR',
    baseUnit: 'Org/Hari', status: 'ACTIVE', specifications: null,
  };
  const kernel = new UnitKernelService({
    unitAlias: {
      findMany: async ({ where }: any) => {
        const code = where.normalizedAlias === 'person_hour' ? PERSON_HOUR
          : where.normalizedAlias === 'org/hari' ? PERSON_DAY : null;
        return code ? [{ id: `unit-alias-${code.code}`, context: 'LABOR', unitDefinition: code }] : [];
      },
    },
    unitConversionRule: {
      findMany: async ({ where }: any) =>
        opts.hasRule &&
        where.sourceUnitId === PERSON_DAY.id &&
        where.targetUnitId === PERSON_HOUR.id
          ? [{
              id: 'certified-7h-rule-fixture',
              version: 1,
              conversionType: 'RESOURCE_SPECIFIC',
              quantityFactor: '7',
              evidenceReference: 'Permen PUPR 8 Tahun 2023, bagian 5.2.1.6-5.2.1.7; TEST FIXTURE ONLY',
              evidenceHash: null, evidencePayload: null,
            }]
          : [],
    },
  } as never);
  const identity = {
    loadEvidence: async () => ({ catalogCandidates: [catalog] }),
    resolve: async () => ({
      status: 'RESOLVED',
      authority: 'CATALOG_ID_REFERENCE_VALIDATED',
      resolvedResourceCatalogId: catalog.id,
      reasonCodes: ['CATALOG_ID_REFERENCE_VALIDATED'],
      explanation: 'ResourceCatalog ID in scenario already proved',
    }),
  };
  const offer = {
    id: 'mock-legal-basic-price-' + component.name,
    resourceId: catalog.id,
    regionId: opts.priceRegion ?? CITY,
    regionCoverageSetId: null, regionCoverageSet: null,
    resource: { baseUnit: 'Org/Hari' },
    value: new Prisma.Decimal('70000.00'),
    sourceOrigin: 'FIELD_REPORT', freshnessStatus: 'CURRENT',
    effectiveDate: new Date('2026-10-20T00:00:00.000Z'),
  };
  const tx = {
    region: { findUnique: async ({ where }: any) => hierarchy[where.id] ?? null },
    $queryRaw: async () => [],
    basicPrice: {
      findMany: async () => [offer],
      findFirst: async ({ where }: any) => where.id === offer.id ? offer : null,
    },
  };
  const orchestrator = new AhspResourceResolutionOrchestrator(
    { usableWhere: () => ({}) } as never, kernel, identity as never,
  );
  const [result] = await orchestrator.resolveVersionResources(tx as never, {
    workspaceId: 'fixture-workspace',
    projectId: 'fixture-project',
    referenceRegionId: CITY,
    asOf: new Date('2026-10-30T00:00:00.000Z'),
    version: {
      id: 'j74-fixture',
      resources: [{
        id: `j74-labor-${component.name}`, resourceId: catalog.id,
        resourceType: 'LABOR', baseUnit: 'PERSON_HOUR',
        coefficient: component.coefficient,
      }],
    },
  });
  return { result, component, offer };
}

describe('RAB-J74: proof of existing Unit Kernel -> Basic Price -> Cost Kernel chain', () => {
  it.each(['Mandor', 'Pekerja'] as const)(
    '%s: one certified directional 7h rule adapts day price to hourly AHSP price',
    async (name) => {
      const { result, component, offer } = await prove({ name, hasRule: true });
      expect(result).toMatchObject({
        status: 'RESOLVED',
        selectedBasicPriceId: offer.id,
        sourceUnit: 'Org/Hari',
        ahspUnit: 'PERSON_HOUR',
        sourcePriceValue: '70000',
        adaptedPriceValue: '10000.00',
        unitConversionRuleId: 'certified-7h-rule-fixture',
        unitConversionRuleVersion: 1,
        quantityFactor: '7',
      });
      expect(result.reasonCodes).toContain('PROVEN_DIRECTIONAL_PRICE_CONVERSION');
      expect(result.explanation).toContain('Kota Administrasi Jakarta Pusat');
      const cost = calculateCostKernel({
        boqItemId: 'j74-boq-fixture',
        ahspVersionId: 'j74-fixture',
        occurrenceId: 'j74-occurrence-fixture',
        occurrenceCount: 1,
        itemType: 'WORK_ITEM',
        volume: '2.50', boqUnit: 'm2', outputUnit: 'm2',
        ownershipMatches: true,
        resources: [{
          ahspResourceId: `j74-labor-${component.name}`,
          resolutionId: `j74-resolution-${component.name}`,
          ahspVersionId: 'j74-fixture',
          status: result.status,
          coefficient: component.coefficient,
          adaptedPriceValue: result.adaptedPriceValue === null ? null : String(result.adaptedPriceValue),
        }],
      });
      expect(cost.status).toBe('CALCULATED');
      // This is a single labor-only fixture, NOT the total J.74 AHSP price.
    },
  );

  it('cannot invent a unit conversion from an existing daily price without a governed directional rule', async () => {
    const { result } = await prove({ name: 'Mandor', hasRule: false });
    expect(result.status).not.toBe('RESOLVED');
    expect(result.adaptedPriceValue).toBeNull();
    expect(result.selectedBasicPriceId).toBeNull();
  });

  it('never borrows a Pancoran Basic Price for the owner-approved Jakarta Pusat occurrence', async () => {
    const { result } = await prove({ name: 'Pekerja', hasRule: true, priceRegion: SIDEWAYS });
    expect(result.status).not.toBe('RESOLVED');
    expect(result.selectedBasicPriceId).toBeNull();
    expect(result.adaptedPriceValue).toBeNull();
  });
  it('fails the actual six-component J.74 shape when even one rate is missing', () => {
    const coefficients = ['0.083300', '0.333300', '0.233000', '0.048000', '0.408000', '1.000000'];
    const mockRates = ['10000.00', '10000.00', '100000.00', '20000.00', '80000.00', null];
    const result = calculateCostKernel({
      boqItemId: 'j74-boq-fixture', ahspVersionId: 'j74-fixture',
      occurrenceId: 'j74-occurrence-fixture', occurrenceCount: 1,
      itemType: 'WORK_ITEM', volume: '2.50', boqUnit: 'm2', outputUnit: 'm2',
      ownershipMatches: true,
      resources: coefficients.map((coefficient, i) => ({
        ahspResourceId: `component-${i}`, resolutionId: `resolution-${i}`,
        ahspVersionId: 'j74-fixture',
        status: mockRates[i] === null ? 'NEEDS_REVIEW' : 'RESOLVED',
        coefficient, adaptedPriceValue: mockRates[i],
      })),
    });
    expect(result.status).toBe('FAIL_CLOSED');
    expect(result).not.toHaveProperty('lineTotal');
  });

  it('uses the existing Cost Kernel for six governed inputs, with no second arithmetic engine', () => {
    // Every rate in this test is entirely hypothetical. None is a Jakarta
    // Basic Price or an approved Alat Bantu policy. This proves plumbing only.
    const coefficients = ['0.083300', '0.333300', '0.233000', '0.048000', '0.408000', '1.000000'];
    const illustrativeRates = ['10000.00', '10000.00', '100000.00', '20000.00', '80000.00', '5000.00'];
    const result = calculateCostKernel({
      boqItemId: 'j74-boq-fixture', ahspVersionId: 'j74-fixture',
      occurrenceId: 'j74-occurrence-fixture', occurrenceCount: 1,
      itemType: 'WORK_ITEM', volume: '2.50', boqUnit: 'm2', outputUnit: 'm2',
      ownershipMatches: true,
      resources: coefficients.map((coefficient, i) => ({
        ahspResourceId: `component-${i}`, resolutionId: `resolution-${i}`,
        ahspVersionId: 'j74-fixture', status: 'RESOLVED',
        coefficient, adaptedPriceValue: illustrativeRates[i],
      })),
    });
    expect(result.status).toBe('CALCULATED');
    if (result.status !== 'CALCULATED') return;
    expect(new Prisma.Decimal(result.lineTotal).equals(
      new Prisma.Decimal(result.ahspUnitPrice).mul('2.5'),
    )).toBe(true);
    expect(new Prisma.Decimal(result.ahspUnitPrice).greaterThan(0)).toBe(true);
  });

});
