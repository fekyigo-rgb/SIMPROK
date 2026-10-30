import { Prisma } from '@prisma/client';
import { calculateCostKernel } from '../project/cost-kernel.kernel';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';

const origin = 'village-gambir';
const district = 'district-gambir';
const city = 'city-jakarta-pusat';
const province = 'province-jakarta';
const otherDistrict = 'district-pancoran';
const hierarchy: Record<string, { id: string; parentId: string | null; administrativeLevel: string; isActive: boolean; name?: string; code?: string }> = {
  [origin]: { id: origin, parentId: district, administrativeLevel: 'VILLAGE', isActive: true },
  [district]: { id: district, parentId: city, administrativeLevel: 'DISTRICT', isActive: true, name: 'Gambir', code: '31.71.01' },
  [city]: { id: city, parentId: province, administrativeLevel: 'REGENCY_CITY', isActive: true },
  [province]: { id: province, parentId: null, administrativeLevel: 'PROVINCE', isActive: true },
};

const catalog = {
  id: 'resource-cat-primer', name: 'Cat Primer', code: null, type: 'MATERIAL',
  baseUnit: 'LITER', status: 'ACTIVE', specifications: null,
};
const price = (id: string, regionId: string, value: string) => ({
  id, regionId, regionCoverageSetId: null, regionCoverageSet: null,
  resourceId: catalog.id, resource: { baseUnit: 'LITER' },
  value: new Prisma.Decimal(value), sourceOrigin: 'FIELD_REPORTED',
  freshnessStatus: 'CURRENT', effectiveDate: new Date('2026-10-01T00:00:00.000Z'),
});

async function run(offers: ReturnType<typeof price>[], sourceRegion = origin) {
  const proofs: Array<{ where: any }> = [];
  const rechecks: string[] = [];
  const identity = {
    loadEvidence: async () => ({ catalogCandidates: [catalog] }),
    resolve: async () => ({
      status: 'RESOLVED', authority: 'CATALOG_ID_REFERENCE_VALIDATED',
      resolvedResourceCatalogId: catalog.id, reasonCodes: ['CATALOG_ID_REFERENCE_VALIDATED'],
      explanation: 'Identitas kanonis terverifikasi.',
    }),
  };
  const unit = {
    resolve: async (from: string, to: string) => ({
      status: from === to ? 'RESOLVED' : 'NEEDS_REVIEW',
      rawSourceUnit: from, rawTargetUnit: to,
      sourceUnitDefinition: { id: 'unit-liter', code: 'LITER' },
      targetUnitDefinition: { id: 'unit-liter', code: 'LITER' },
      quantityFactor: '1', priceOperation: 'IDENTITY',
    }),
  };
  const db = {
    $queryRaw: async () => [],
    region: { findUnique: async ({ where }: any) => hierarchy[where.id] ?? null },
    basicPrice: {
      findMany: async ({ where }: any) => { proofs.push({ where }); return offers; },
      findFirst: async ({ where }: any) => {
        const exact = offers.find((p) => p.id === where.id);
        if (!exact) return null;
        // The same canonical exact-region predicate MUST admit this selected
        // price again, or the frozen occurrence must not contain a fake rate.
        const regionWhere = JSON.stringify(where.AND ?? []);
        if (!regionWhere.includes(exact.regionId)) return null;
        rechecks.push(exact.id);
        return exact;
      },
    },
  };
  const orchestrator = new AhspResourceResolutionOrchestrator(
    { usableWhere: () => ({}) } as never, unit as never, identity as never,
  );
  const [resolution] = await orchestrator.resolveVersionResources(db as never, {
    workspaceId: 'workspace-1', projectId: 'project-1', referenceRegionId: sourceRegion,
    asOf: new Date('2026-10-30T00:00:00.000Z'),
    version: {
      id: 'version-1',
      resources: [{ id: 'ahsp-resource-1', resourceId: catalog.id,
        baseUnit: 'LITER', resourceType: 'MATERIAL', coefficient: '2' }],
    },
  });
  return { resolution, proofs, rechecks };
}

describe('RAB-36B: canonical Region priority -> existing price kernel -> Cost Kernel', () => {
  it('picks village price before an otherwise cheaper district or province price', async () => {
    const { resolution, rechecks } = await run([
      price('province-cheaper', province, '10.00'),
      price('district-cheaper', district, '20.00'),
      price('village-price', origin, '100.00'),
    ]);
    expect(resolution).toMatchObject({
      status: 'RESOLVED', selectedBasicPriceId: 'village-price',
      sourcePriceValue: '100',
      adaptedPriceValue: '100',
    });
    expect(rechecks).toEqual(['village-price']);
    expect(resolution.explanation).toContain('tier VILLAGE');
    expect(resolution.explanation).toContain(origin);
  });
  it('falls back to district; official Cost Kernel prices and totals that selected rate', async () => {
    const { resolution, rechecks, proofs } = await run([
      price('province-price', province, '200.00'),
      price('district-price', district, '100.00'),
      price('sibling-forbidden', otherDistrict, '1.00'),
    ]);
    expect(resolution.status).toBe('RESOLVED');
    expect(resolution.selectedBasicPriceId).toBe('district-price');
    expect(resolution.explanation).toContain('tier DISTRICT');
    expect(resolution.explanation).toContain('Gambir (31.71.01)');
    expect(rechecks).toEqual(['district-price']);
    const qualifiedOfferQuery = JSON.stringify(proofs[proofs.length - 1]?.where);
    for (const approvedTier of [origin, district, city, province]) {
      expect(qualifiedOfferQuery).toContain(approvedTier);
    }
    expect(qualifiedOfferQuery).not.toContain(otherDistrict);
    const calculation = calculateCostKernel({
      boqItemId: 'boq-1', ahspVersionId: 'version-1',
      occurrenceId: 'occurrence-from-official-writer', occurrenceCount: 1,
      itemType: 'WORK_ITEM', volume: '3', boqUnit: 'm2', outputUnit: 'm2',
      ownershipMatches: true,
      resources: [{
        ahspResourceId: 'ahsp-resource-1', resolutionId: 'resolution-1',
        ahspVersionId: 'version-1', status: resolution.status,
        coefficient: String(resolution.ahspCoefficient),
        adaptedPriceValue: resolution.adaptedPriceValue === null
          ? null : String(resolution.adaptedPriceValue),
      }],
    });
    expect(calculation).toMatchObject({
      status: 'CALCULATED', ahspUnitPrice: '200', lineTotal: '600',
      calculationPolicy: 'COST_KERNEL_GRADE_A_V1',
    });
  });
  it('does not drop conflicting same-tier prices to take a province price', async () => {
    const { resolution } = await run([
      price('district-1', district, '100.00'),
      price('district-2', district, '101.00'),
      price('province', province, '80.00'),
    ]);
    expect(resolution.status).toBe('NEEDS_REVIEW');
    expect(resolution.selectedBasicPriceId).toBeNull();
    expect(resolution.reasonCodes).toContain('MULTIPLE_BASIC_PRICE_CANDIDATES');
  });
  it('does not use a sibling district to make unavailable pricing appear complete', async () => {
    const { resolution, rechecks } = await run([
      price('sibling', otherDistrict, '1.00'),
    ]);
    expect(resolution.status).toBe('UNRESOLVED');
    expect(resolution.reasonCodes).toContain('NO_BASIC_PRICE_CANDIDATE');
    expect(rechecks).toEqual([]);
  });
  it('starts at an Owner-approved city, never descends to someone else’s district', async () => {
    const { resolution } = await run([
      price('pancoran', otherDistrict, '100.00'),
      price('province-valid', province, '160.00'),
    ], city);
    expect(resolution.selectedBasicPriceId).toBe('province-valid');
    expect(resolution.explanation).toContain('tier PROVINCE');
  });
  it('fails closed on an unproven hierarchy rather than guessing a parent', async () => {
    await expect(run([], 'village-unknown'))
      .rejects.toThrow('RAB_PRICE_REGION_HIERARCHY_UNPROVEN');
  });
});
