import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';

/**
 * B1B12-BROWSER-BRIDGE — the AHSP occurrence path must ask the unit question
 * WITH the trusted context it already holds.
 *
 * "jam" is one spelling for two different canonical units: a labourer's hour
 * (PERSON_TIME) and a machine's hour (EQUIPMENT_TIME). The Unit Kernel has
 * been able to tell them apart since the B1-B12 catalogue landed, but only
 * when the caller supplies the trusted context — and this orchestrator, the
 * one that resolves every AHSP resource for a project occurrence, was calling
 * it without one. Every LABOR and EQUIPMENT resource priced per hour therefore
 * came back AMBIGUOUS_UNIT_ALIAS -> UNIT_NOT_SUPPORTED -> UNRESOLVED, and no
 * such row could ever be priced. That is the whole defect this file pins.
 *
 * The context is `ResourceCatalog.type` — a governed classification, never a
 * guess from the resource NAME, exactly as UNIT_ALIAS_CONTEXT requires. It is
 * safe to use the catalog's class for the AHSP line too, because identity
 * resolution admits a candidate only when the two types already match.
 *
 * No database: the Unit Kernel is driven through a structural client holding
 * only the rows this proof needs, the same discipline the B1-B12 Golden unit
 * coverage spec uses.
 */

const UNIT = {
  PERSON_HOUR: {
    id: 'unit-person-hour',
    code: 'PERSON_HOUR',
    dimension: 'PERSON_TIME',
  },
  EQUIPMENT_HOUR: {
    id: 'unit-equipment-hour',
    code: 'EQUIPMENT_HOUR',
    dimension: 'EQUIPMENT_TIME',
  },
} as const;

/** The two context-scoped "jam" rows the shipped catalogue actually carries. */
const JAM_ALIASES = [
  { id: 'alias-jam-labor', context: 'LABOR', unitDefinition: UNIT.PERSON_HOUR },
  {
    id: 'alias-jam-equipment',
    context: 'EQUIPMENT',
    unitDefinition: UNIT.EQUIPMENT_HOUR,
  },
];

function makeUnitKernel(): UnitKernelService {
  const prisma = {
    unitAlias: {
      findMany: async ({ where }: any) =>
        where.normalizedAlias === 'jam' ? JAM_ALIASES : [],
    },
    unitConversionRule: { findMany: async () => [] },
  };
  return new UnitKernelService(prisma as never);
}

const CATALOG = {
  pekerja: {
    id: 'catalog-pekerja',
    code: 'L01',
    name: 'Pekerja',
    type: 'LABOR',
    baseUnit: 'jam',
    status: 'ACTIVE',
    specifications: null,
  },
  excavator: {
    id: 'catalog-excavator',
    code: 'E10a',
    name: 'Mini Excavator',
    type: 'EQUIPMENT',
    baseUnit: 'jam',
    status: 'ACTIVE',
    specifications: null,
  },
} as const;

const PRICE = {
  pekerja: {
    id: 'price-pekerja',
    resourceId: CATALOG.pekerja.id,
    value: { toString: () => '27643.54' },
    sourceOrigin: 'FIELD_REPORTED',
    freshnessStatus: 'CURRENT',
    effectiveDate: new Date('2026-08-12T00:00:00.000Z'),
    resource: { baseUnit: 'jam' },
  },
  excavator: {
    id: 'price-excavator',
    resourceId: CATALOG.excavator.id,
    value: { toString: () => '281237.82' },
    sourceOrigin: 'FIELD_REPORTED',
    freshnessStatus: 'CURRENT',
    effectiveDate: new Date('2026-08-12T00:00:00.000Z'),
    resource: { baseUnit: 'jam' },
  },
} as const;

/**
 * Identity is settled by its OWN authority and is not what this file tests, so
 * it is stubbed to the exact-canonical-match verdict the real kernel returns
 * for these rows. Everything downstream — units, eligibility, price selection
 * — is the real code.
 */
function makeOrchestrator() {
  const eligibility = { usableWhere: () => ({}) } as any;
  const identity = {
    loadEvidence: async () => ({
      catalogCandidates: Object.values(CATALOG),
      sourceSightings: [],
      reviewedMappings: [],
    }),
    resolve: (evidence: any, reference: any) => {
      const match = evidence.catalogCandidates.find(
        (candidate: any) =>
          candidate.name.toLowerCase() === reference.rawName.toLowerCase() &&
          candidate.type === reference.resourceType,
      );
      return match
        ? {
            status: 'RESOLVED',
            authority: 'EXACT_CANONICAL_MATCH',
            resolvedResourceCatalogId: match.id,
            candidates: [],
            reasonCodes: ['EXACT_CANONICAL_MATCH'],
            explanation: '',
          }
        : {
            status: 'UNRESOLVED',
            authority: null,
            resolvedResourceCatalogId: null,
            candidates: [],
            reasonCodes: ['RESOURCE_NOT_FOUND'],
            explanation: '',
          };
    },
  } as any;
  return new AhspResourceResolutionOrchestrator(
    eligibility,
    makeUnitKernel(),
    identity,
  );
}

const tx = {
  basicPrice: {
    findMany: async () => [PRICE.pekerja, PRICE.excavator],
    findFirst: async ({ where }: any) =>
      [PRICE.pekerja, PRICE.excavator].find((row) => row.id === where.id) ??
      null,
  },
} as any;

const run = (
  resources: Array<{
    id: string;
    resourceId: string;
    resourceType: string;
    coefficient: string;
    baseUnit: string;
  }>,
) =>
  makeOrchestrator().resolveVersionResources(tx, {
    workspaceId: 'workspace-fixture',
    projectId: 'project-fixture',
    referenceRegionId: 'region-fixture',
    asOf: new Date('2026-08-13T00:00:00.000Z'),
    version: { id: 'version-fixture', resources },
  });

describe('AHSP resource resolution — trusted unit context', () => {
  it('reads "jam" on a LABOR line as the PERSON hour and prices it', async () => {
    const [resolution] = await run([
      {
        id: 'ahsp-resource-pekerja',
        resourceId: 'Pekerja',
        resourceType: 'LABOR',
        coefficient: '0.2914',
        baseUnit: 'jam',
      },
    ]);

    expect(resolution).toMatchObject({
      status: 'RESOLVED',
      resourceCatalogId: CATALOG.pekerja.id,
      selectedBasicPriceId: PRICE.pekerja.id,
      canonicalUnit: 'PERSON_HOUR',
      adaptedPriceValue: '27643.54',
      // A spelling is not a conversion: the price basis is untouched.
      quantityFactor: '1',
    });
    expect(resolution.sourceUnitDefinitionId).toBe(UNIT.PERSON_HOUR.id);
    expect(resolution.targetUnitDefinitionId).toBe(UNIT.PERSON_HOUR.id);
  });

  it('reads the SAME spelling on an EQUIPMENT line as the MACHINE hour', async () => {
    const [resolution] = await run([
      {
        id: 'ahsp-resource-excavator',
        resourceId: 'Mini Excavator',
        resourceType: 'EQUIPMENT',
        coefficient: '0.0486',
        baseUnit: 'jam',
      },
    ]);

    expect(resolution).toMatchObject({
      status: 'RESOLVED',
      resourceCatalogId: CATALOG.excavator.id,
      selectedBasicPriceId: PRICE.excavator.id,
      canonicalUnit: 'EQUIPMENT_HOUR',
      adaptedPriceValue: '281237.82',
    });
    expect(resolution.sourceUnitDefinitionId).toBe(UNIT.EQUIPMENT_HOUR.id);
  });

  it('never lets one line’s hour become the other’s — both resolve in ONE version, each to its own unit', async () => {
    const resolutions = await run([
      {
        id: 'ahsp-resource-pekerja',
        resourceId: 'Pekerja',
        resourceType: 'LABOR',
        coefficient: '0.2914',
        baseUnit: 'jam',
      },
      {
        id: 'ahsp-resource-excavator',
        resourceId: 'Mini Excavator',
        resourceType: 'EQUIPMENT',
        coefficient: '0.0486',
        baseUnit: 'jam',
      },
    ]);

    expect(resolutions.map((row) => row.status)).toEqual([
      'RESOLVED',
      'RESOLVED',
    ]);
    expect(resolutions.map((row) => row.canonicalUnit)).toEqual([
      'PERSON_HOUR',
      'EQUIPMENT_HOUR',
    ]);
    // The labourer is never priced from the machine's rate, or vice versa.
    expect(resolutions.map((row) => row.adaptedPriceValue)).toEqual([
      '27643.54',
      '281237.82',
    ]);
  });

  it('is the context that does it — the same kernel refuses "jam" when asked without one', async () => {
    const withoutContext = await makeUnitKernel().resolve('jam', 'jam');
    expect(withoutContext.status).toBe('NEEDS_REVIEW');
    expect(withoutContext.reasonCodes).toContain('AMBIGUOUS_UNIT_ALIAS');
    expect(withoutContext.sourceUnitDefinition).toBeNull();
  });

  it('still fails closed when the unit genuinely cannot be proved', async () => {
    const [resolution] = await run([
      {
        id: 'ahsp-resource-unknown-unit',
        resourceId: 'Pekerja',
        resourceType: 'LABOR',
        // A spelling the catalogue does not carry. Trusted context does not
        // make an unknown alias knowable, and must not.
        baseUnit: 'zzz-not-a-unit',
      } as never,
    ]);

    expect(resolution.status).toBe('UNRESOLVED');
    expect(resolution.reasonCodes).toContain('UNIT_NOT_SUPPORTED');
    expect(resolution.adaptedPriceValue).toBeNull();
    expect(resolution.selectedBasicPriceId).toBeNull();
  });
});
