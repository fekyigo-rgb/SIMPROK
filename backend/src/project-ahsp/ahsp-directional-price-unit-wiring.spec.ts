import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';

/**
 * Live consumer wiring proof with the REAL Unit Kernel.
 * In-memory Prisma read stubs ONLY. No DB, HTTP, write, or runtime mutation.
 */
const ZAK = { id: 'unit-zak', code: 'PACKAGE_ZAK', dimension: 'PACKAGE' };
const KG = { id: 'unit-kg', code: 'MASS_KG', dimension: 'MASS' };
const catalog = {
  id: 'catalog-zak',
  name: 'Material Fiktif',
  code: null,
  type: 'MATERIAL',
  baseUnit: 'zak',
  status: 'ACTIVE',
  specifications: null,
};
const makePrice = (value: string) => ({
  id: 'price-zak',
  resourceId: catalog.id,
  resource: { baseUnit: 'zak' },
  value: { toString: () => value },
  sourceOrigin: 'FIELD_REPORT',
  freshnessStatus: 'CURRENT',
  effectiveDate: new Date('2026-10-29T00:00:00.000Z'),
});

async function resolvePrice(input: {
  value?: string;
  factor?: string;
  forwardRule?: boolean;
  effectiveRule?: boolean;
}) {
  const price = makePrice(input.value ?? '80000.00');
  const unitKernel = new UnitKernelService({
    unitAlias: {
      findMany: async ({ where }: any) =>
        where.normalizedAlias === 'zak'
          ? [{ id: 'alias-zak', context: null, unitDefinition: ZAK }]
          : where.normalizedAlias === 'kg'
            ? [{ id: 'alias-kg', context: null, unitDefinition: KG }]
            : [],
    },
    unitConversionRule: {
      findMany: async ({ where }: any) =>
        input.forwardRule !== false &&
        where.sourceUnitId === ZAK.id &&
        where.targetUnitId === KG.id
          ? [
              {
                id: 'rule-zak-kg',
                version: 1,
                quantityFactor: input.factor ?? '40',
                conversionType: 'PACKAGE_CONTENT',
                evidenceReference:
                  input.effectiveRule === false
                    ? null
                    : 'verified-package-40kg',
                evidenceHash: null,
                evidencePayload: null,
              },
            ]
          : [],
    },
  } as never);
  const identity = {
    loadEvidence: async () => ({ catalogCandidates: [catalog] }),
    resolve: async () => ({
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH',
      resolvedResourceCatalogId: catalog.id,
      reasonCodes: ['EXACT_CANONICAL_MATCH'],
      explanation: 'Identitas terverifikasi',
      candidates: [],
    }),
  };
  const orchestrator = new AhspResourceResolutionOrchestrator(
    { usableWhere: () => ({}) } as never,
    unitKernel,
    identity as never,
  );
  const tx = {
    $queryRaw: async () => [],
    basicPrice: {
      findMany: async () => [price],
      findFirst: async ({ where }: any) =>
        where.id === price.id ? price : null,
    },
  };
  const [row] = await orchestrator.resolveVersionResources(tx as never, {
    workspaceId: 'ws-1',
    projectId: 'project-1',
    referenceRegionId: 'region-1',
    asOf: new Date('2026-10-30T00:00:00.000Z'),
    version: {
      id: 'ahsp-version-1',
      resources: [
        {
          id: 'ahsp-resource-1',
          resourceId: catalog.name,
          resourceType: 'MATERIAL',
          coefficient: '2',
          baseUnit: 'kg',
        },
      ],
    },
  });
  return row;
}

describe('SCOPE-02 — certified direct Basic Price -> AHSP adaptation', () => {
  it('uses a direct zak -> kg UnitKernel rule, without needing kg -> zak', async () => {
    const row = await resolvePrice({});
    expect(row).toMatchObject({
      status: 'RESOLVED',
      selectedBasicPriceId: 'price-zak',
      sourceUnit: 'zak',
      sourcePriceValue: '80000.00',
      ahspUnit: 'kg',
      adaptedPriceValue: '2000.00',
      canonicalUnit: KG.code,
      sourceUnitDefinitionId: ZAK.id,
      targetUnitDefinitionId: KG.id,
      unitConversionRuleId: 'rule-zak-kg',
      unitConversionRuleVersion: 1,
      quantityFactor: '40',
      conversionFactor: null,
      policyVersion: 'E1A_PRICE_DIRECTIONAL_V1',
    });
    expect(row.reasonCodes).toContain('PROVEN_DIRECTIONAL_PRICE_CONVERSION');
    expect(row.explanation).toContain('80000.00 per zak');
    expect(row.explanation).toContain('2000.00 per kg');
  });

  it('holds when the required forward rule is missing; never inverts reverse', async () => {
    const row = await resolvePrice({ forwardRule: false });
    expect(row.status).not.toBe('RESOLVED');
    expect(row.adaptedPriceValue).toBeNull();
    expect(row.selectedBasicPriceId).toBeNull();
  });

  it('holds when the rule has no package evidence', async () => {
    const row = await resolvePrice({ effectiveRule: false });
    expect(row.status).not.toBe('RESOLVED');
    expect(row.selectedBasicPriceId).toBeNull();
  });

  it('holds non-cent-accurate conversion, keeping source unchanged', async () => {
    const row = await resolvePrice({ value: '100.00', factor: '3' });
    expect(row.status).toBe('NEEDS_REVIEW');
    expect(row.reasonCodes).toContain('UNIT_CONVERSION_UNPROVED');
    expect(row.adaptedPriceValue).toBeNull();
    expect(row.selectedBasicPriceId).toBeNull();
  });
});
