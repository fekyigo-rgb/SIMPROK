import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { AhspResourceResolutionOrchestrator } from './ahsp-resource-resolution.orchestrator';

/**
 * RM-03D2 — the representation tie, end to end on the Golden Thread.
 *
 * Nothing is stubbed except the database rows. The REAL identity service, the
 * REAL Unit Kernel, the REAL eligibility policy and the REAL price kernel all
 * run, so what this file proves is the shipped decision path:
 *
 *   1. a tied AHSP resource is settled by its own stated unit and goes on to be
 *      priced through the existing price authority — no second price path;
 *   2. an unprovable resource still withholds only its own row;
 *   3. the occurrence path and the RAB pre-lock gate cannot disagree, because
 *      they are the same call;
 *   4. the canonical-unit read happens on the CALLER'S transaction.
 */

const UNIT = {
  M3: { id: 'unit-m3', code: 'M3', dimension: 'VOLUME' },
  KG: { id: 'unit-kg', code: 'KG', dimension: 'MASS' },
  PERSON_HOUR: { id: 'unit-person-hour', code: 'PERSON_HOUR', dimension: 'PERSON_TIME' },
  PERSON_DAY: { id: 'unit-person-day', code: 'PERSON_DAY', dimension: 'PERSON_TIME' },
  EQUIPMENT_HOUR: { id: 'unit-equipment-hour', code: 'EQUIPMENT_HOUR', dimension: 'EQUIPMENT_TIME' },
} as const;

const ALIASES = [
  { id: 'alias-m3', normalizedAlias: 'm3', context: null, unitDefinition: UNIT.M3 },
  { id: 'alias-kg', normalizedAlias: 'kg', context: null, unitDefinition: UNIT.KG },
  // The shipped catalogue's real context-scoped spelling: "jam" is a labourer's
  // hour on LABOR and a machine's hour on EQUIPMENT. Neither meaning is valid
  // outside its context, so any identity it settles is a NARROWER claim than a
  // context-free one — and the stored row has to say so.
  { id: 'alias-jam-labor', normalizedAlias: 'jam', context: 'LABOR', unitDefinition: UNIT.PERSON_HOUR },
  { id: 'alias-jam-equipment', normalizedAlias: 'jam', context: 'EQUIPMENT', unitDefinition: UNIT.EQUIPMENT_HOUR },
  { id: 'alias-oh-labor', normalizedAlias: 'oh', context: 'LABOR', unitDefinition: UNIT.PERSON_DAY },
];

/**
 * The Owner's Golden B1-B12 fact: "Mortar" (M279) is priced per m3 in B4-B8 and
 * per kg in B9-B10, so ONE name and class carries two catalog representations.
 */
const CATALOG = {
  mortarM3: { id: 'catalog-mortar-m3', code: null, name: 'Mortar', type: 'MATERIAL', baseUnit: 'm3', status: 'ACTIVE', specifications: null },
  mortarKg: { id: 'catalog-mortar-kg', code: null, name: 'Mortar', type: 'MATERIAL', baseUnit: 'kg', status: 'ACTIVE', specifications: null },
  batu: { id: 'catalog-batu', code: null, name: 'Batu Belah', type: 'MATERIAL', baseUnit: 'm3', status: 'ACTIVE', specifications: null },
  // A second same-name/different-unit pair, this time with the m3 row STATING a
  // structured fact the source never mentions. Used to prove the specification
  // guards still run after unit context has settled the cardinality question —
  // RM-03D2 is a way THROUGH the tie, never around the false-certainty law.
  //
  // A name-designation CONFLICT is unreachable here by construction: a tie
  // requires the names to be exactly equal, so the two sides can never state
  // contradicting designations. The reachable guard is the structured one.
  angkerM3: { id: 'catalog-angker-m3', code: null, name: 'Besi angker', type: 'MATERIAL', baseUnit: 'm3', status: 'ACTIVE', specifications: { diameter: 16 } },
  angkerKg: { id: 'catalog-angker-kg', code: null, name: 'Besi angker', type: 'MATERIAL', baseUnit: 'kg', status: 'ACTIVE', specifications: null },
  // A LABOR tie whose discriminating spelling is context-scoped — the shape
  // where the authority story is genuinely weaker and must not be recorded as
  // though "jam" had been globally unambiguous.
  pekerjaJam: { id: 'catalog-pekerja-jam', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'jam', status: 'ACTIVE', specifications: null },
  pekerjaOh: { id: 'catalog-pekerja-oh', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'OH', status: 'ACTIVE', specifications: null },
} as const;

const price = (id: string, resourceId: string, value: string, baseUnit: string) => ({
  id,
  resourceId,
  value: { toString: () => value },
  sourceOrigin: 'FIELD_REPORTED',
  freshnessStatus: 'CURRENT',
  effectiveDate: new Date('2026-08-12T00:00:00.000Z'),
  resource: { baseUnit },
});

const PRICES = [
  price('price-mortar-m3', CATALOG.mortarM3.id, '4752.00', 'm3'),
  price('price-mortar-kg', CATALOG.mortarKg.id, '4752.00', 'kg'),
  price('price-batu', CATALOG.batu.id, '250000.00', 'm3'),
  price('price-pekerja-jam', CATALOG.pekerjaJam.id, '18000.00', 'jam'),
];

/**
 * One structural client standing in for the caller's open transaction.
 *
 * `prices` is a parameter so a case can withhold the Basic Price WITHOUT
 * touching the catalog — which is the only way to observe what a row records
 * when identity is proven and pricing is not.
 */
function makeTx(prices: typeof PRICES = PRICES) {
  const unitAliasFindMany = jest.fn(async ({ where }: any) => {
    const wanted: string[] = where.normalizedAlias?.in ?? [where.normalizedAlias];
    return ALIASES.filter((alias) => wanted.includes(alias.normalizedAlias));
  });
  return {
    unitAliasFindMany,
    tx: {
      unitAlias: { findMany: unitAliasFindMany },
      resourceCatalog: { findMany: async () => Object.values(CATALOG) },
      resourceSourceIdentity: { findMany: async () => [] },
      basicPriceImportRowResourceMapping: { findMany: async () => [] },
      basicPrice: {
        findMany: async () => prices,
        findFirst: async ({ where }: any) => prices.find((row) => row.id === where.id) ?? null,
      },
    } as any,
  };
}

/**
 * The Unit Kernel's own global client, mirroring production: the pre-existing
 * `resolve()` (unit equivalence for pricing) reads through it, and RM-03D2 did
 * not change that — repairing that older seam is explicitly out of this slice.
 *
 * What RM-03D2 DID change is where the CANONICAL-IDENTITY read happens, and the
 * tests below pin exactly that: the batched lookup (`normalizedAlias: { in }`)
 * must land on the caller's transaction and never here.
 */
function makeOrchestrator() {
  const globalClient = {
    unitAlias: {
      findMany: jest.fn(async ({ where }: any) => {
        const wanted: string[] = where.normalizedAlias?.in ?? [where.normalizedAlias];
        return ALIASES.filter((alias) => wanted.includes(alias.normalizedAlias));
      }),
    },
    unitConversionRule: { findMany: jest.fn(async () => []) },
  };
  const units = new UnitKernelService(globalClient as never);
  const identity = new ResourceIdentityResolutionService(
    globalClient as never,
    units,
  );
  return {
    globalClient,
    units,
    orchestrator: new AhspResourceResolutionOrchestrator(
      new BasicPriceEligibilityPolicy(),
      units,
      identity,
    ),
  };
}

const resource = (
  over: Partial<{ id: string; resourceId: string; resourceType: string; coefficient: string; baseUnit: string }> & { id: string },
) => ({
  resourceId: 'Mortar',
  resourceType: 'MATERIAL',
  coefficient: '0.480000',
  baseUnit: 'm3',
  ...over,
});

const run = async (resources: any[], parts = makeOrchestrator(), context = makeTx()) => ({
  resolutions: await parts.orchestrator.resolveVersionResources(context.tx, {
    workspaceId: 'workspace-fixture',
    projectId: 'project-fixture',
    referenceRegionId: 'region-fixture',
    asOf: new Date('2026-08-13T00:00:00.000Z'),
    version: { id: 'version-fixture', resources },
  }),
  parts,
  context,
});

describe('RM-03D2 — representation tie on the Golden Thread', () => {
  it('a tied Mortar line stated in m3 resolves and is PRICED through the existing price authority', async () => {
    const { resolutions } = await run([resource({ id: 'ahsp-mortar-m3', baseUnit: 'm3' })]);

    expect(resolutions[0]).toMatchObject({
      status: 'RESOLVED',
      resourceCatalogId: CATALOG.mortarM3.id,
      selectedBasicPriceId: 'price-mortar-m3',
      canonicalUnit: 'M3',
      adaptedPriceValue: '4752.00',
      quantityFactor: '1',
    });
    // The audit trail says HOW the identity was settled — a tie decided by the
    // source's own unit, not a lone exact name match.
    expect(resolutions[0].reasonCodes).toContain(
      'EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT',
    );
    expect(resolutions[0].reasonCodes).not.toContain('EXACT_RESOURCE_NAME_MATCH');
  });

  it('the SAME tie stated in kg resolves to the kg representation and its own price', async () => {
    const { resolutions } = await run([resource({ id: 'ahsp-mortar-kg', baseUnit: 'kg' })]);

    expect(resolutions[0]).toMatchObject({
      status: 'RESOLVED',
      resourceCatalogId: CATALOG.mortarKg.id,
      selectedBasicPriceId: 'price-mortar-kg',
      canonicalUnit: 'KG',
    });
  });

  it('resolves the canonical unit on the CALLER transaction, never a second client', async () => {
    const { parts, context } = await run([resource({ id: 'ahsp-mortar-m3' })]);

    const batchedOnTx = context.unitAliasFindMany.mock.calls.filter(
      ([arg]: any[]) => arg?.where?.normalizedAlias?.in,
    );
    const batchedOffTx = (parts.globalClient.unitAlias.findMany as jest.Mock).mock.calls.filter(
      ([arg]: any[]) => arg?.where?.normalizedAlias?.in,
    );

    // The canonical-unit evidence that settled the tie was read inside the
    // caller's consistency window, and nowhere else.
    expect(batchedOnTx).toHaveLength(1);
    expect(batchedOffTx).toHaveLength(0);
  });

  it('one unprovable resource withholds ONLY its own row — every other line still prices', async () => {
    const { resolutions } = await run([
      resource({ id: 'ahsp-mortar-m3', baseUnit: 'm3' }),
      resource({ id: 'ahsp-unknown', resourceId: 'Sumber Daya Tak Dikenal', baseUnit: 'm3' }),
      resource({ id: 'ahsp-batu', resourceId: 'Batu Belah', coefficient: '1.200000', baseUnit: 'm3' }),
    ]);

    expect(resolutions).toHaveLength(3);
    expect(resolutions[0].status).toBe('RESOLVED');
    expect(resolutions[1].status).toBe('UNRESOLVED');
    expect(resolutions[1].reasonCodes).toContain('RESOURCE_NOT_FOUND');
    // The loop continued past the failure: the line AFTER it is fully priced.
    expect(resolutions[2]).toMatchObject({
      status: 'RESOLVED',
      resourceCatalogId: CATALOG.batu.id,
      selectedBasicPriceId: 'price-batu',
    });
  });

  it('a tie whose unit cannot be proved stays NEEDS_REVIEW and says exactly why', async () => {
    const { resolutions } = await run([
      resource({ id: 'ahsp-mortar-weird', baseUnit: 'satuan-tak-dikenal' }),
    ]);

    expect(resolutions[0].status).toBe('NEEDS_REVIEW');
    expect(resolutions[0].resourceCatalogId).toBeNull();
    expect(resolutions[0].selectedBasicPriceId).toBeNull();
    expect(resolutions[0].reasonCodes).toEqual([
      'MULTIPLE_CANDIDATES_NEEDS_REVIEW',
      'UNIT_CONTEXT_SOURCE_UNIT_UNPROVED',
    ]);
    expect(resolutions[0].explanation).toContain('UNKNOWN_UNIT_ALIAS');
  });

  it('proves the tie units ONCE for a whole version, however many lines tie', async () => {
    const { context } = await run([
      resource({ id: 'ahsp-mortar-1', baseUnit: 'm3' }),
      resource({ id: 'ahsp-mortar-2', baseUnit: 'm3' }),
      resource({ id: 'ahsp-mortar-3', baseUnit: 'kg' }),
    ]);

    const batched = context.unitAliasFindMany.mock.calls.filter(
      ([arg]: any[]) => arg?.where?.normalizedAlias?.in,
    );
    expect(batched).toHaveLength(1);
  });

  it('adds NO canonical-unit query at all when no line ties', async () => {
    const { context } = await run([
      resource({ id: 'ahsp-batu', resourceId: 'Batu Belah', coefficient: '1.2', baseUnit: 'm3' }),
    ]);

    const batched = context.unitAliasFindMany.mock.calls.filter(
      ([arg]: any[]) => arg?.where?.normalizedAlias?.in,
    );
    expect(batched).toHaveLength(0);
  });
});

/**
 * WHAT THE ROW ACTUALLY SAYS AFTERWARDS.
 *
 * A correct decision recorded with a false reason is not Super Grade-A. These
 * cases read the persisted `explanation`/`reasonCodes` a human and an auditor
 * will actually see, and hold them to one rule: the stored sentence must not
 * tell a simpler story than the one that happened.
 */
describe('RM-03D2 — persisted truth', () => {
  it('1. a SINGLE exact identity is never given tie wording it did not earn', async () => {
    const { resolutions } = await run([
      resource({ id: 'ahsp-batu', resourceId: 'Batu Belah', coefficient: '1.200000', baseUnit: 'm3' }),
    ]);

    expect(resolutions[0].status).toBe('RESOLVED');
    expect(resolutions[0].reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH');
    expect(resolutions[0].reasonCodes).not.toContain('EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT');
    // No representation tie existed, so nothing may claim one was broken.
    expect(resolutions[0].explanation).not.toContain('representasi');
    expect(resolutions[0].explanation).toContain('cocok persis');
  });

  it.each([
    ['m3', CATALOG.mortarM3, 'M3', 'price-mortar-m3'],
    ['kg', CATALOG.mortarKg, 'KG', 'price-mortar-kg'],
  ])(
    '2/3. Mortar in %s keeps BOTH the identity story and the pricing story',
    async (unit, catalog, canonical, priceId) => {
      const { resolutions } = await run([resource({ id: `ahsp-mortar-${unit}`, baseUnit: unit })]);
      const row = resolutions[0];

      expect(row).toMatchObject({
        status: 'RESOLVED',
        resourceCatalogId: catalog.id,
        selectedBasicPriceId: priceId,
        canonicalUnit: canonical,
      });
      // Machine-readable and human-readable must agree (§5).
      expect(row.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT');
      expect(row.reasonCodes).not.toContain('EXACT_RESOURCE_NAME_MATCH');

      // THE DEFECT THIS CLOSES: the stored sentence used to be "…melalui
      // kecocokan nama tepat…" alone, which hid that two exact representations
      // existed and that the source's own unit chose between them.
      expect(row.explanation).toContain('2 representasi');
      expect(row.explanation).toContain(`"${unit}"`);
      expect(row.explanation).toContain(`unit canonical ${canonical}`);
      expect(row.explanation).toContain(catalog.id);
      expect(row.explanation).toContain('EXACT_UNIT_IDENTITY');
      expect(row.explanation).toContain('spesifikasi');
      // The pricing story is composed on TOP, not substituted for it.
      expect(row.explanation).toContain(priceId);
      expect(row.explanation).toContain('SIMPROK menghitung');
      // And the identity phrase in the price leg no longer contradicts the
      // reason codes by calling this a lone exact name match.
      expect(row.explanation).toContain('dibedakan oleh identitas unit canonical');
    },
  );

  it('4. identity proven + price UNRESOLVED — the proven identity is not erased', async () => {
    // Every catalog row is unchanged; only the Basic Price for the m3
    // representation is withheld. Identity is therefore fully settled and the
    // failure is purely a pricing failure — the row must say exactly that.
    const withoutMortarM3 = PRICES.filter((row) => row.id !== 'price-mortar-m3');
    const { resolutions } = await run(
      [resource({ id: 'ahsp-mortar-m3', baseUnit: 'm3' })],
      makeOrchestrator(),
      makeTx(withoutMortarM3),
    );
    const row = resolutions[0];

    expect(row.status).toBe('UNRESOLVED');
    expect(row.selectedBasicPriceId).toBeNull();
    expect(row.reasonCodes).toContain('NO_BASIC_PRICE_CANDIDATE');
    // Identity authority survives its own success even though pricing failed.
    expect(row.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT');
    expect(row.explanation).toContain('2 representasi');
    expect(row.explanation).toContain('unit canonical M3');
    expect(row.explanation).toContain(CATALOG.mortarM3.id);
    // …and the price uncertainty is stated as a SEPARATE fact.
    expect(row.explanation).toContain('tidak ada Basic Price');
  });

  it('6. a CONTEXT-SCOPED meaning is recorded as context-scoped, all the way to the row', async () => {
    // "jam" settles this tie only because the resource is governed as LABOR.
    // That is a materially narrower claim than "m3 means M3 everywhere", and the
    // stored row must preserve the difference — otherwise an auditor reading it
    // later would believe the spelling had been unambiguous on its own.
    const { resolutions } = await run([
      resource({ id: 'ahsp-pekerja', resourceId: 'Pekerja', resourceType: 'LABOR', baseUnit: 'jam' }),
    ]);
    const row = resolutions[0];

    expect(row).toMatchObject({
      status: 'RESOLVED',
      resourceCatalogId: CATALOG.pekerjaJam.id,
      selectedBasicPriceId: 'price-pekerja-jam',
      canonicalUnit: 'PERSON_HOUR',
    });
    expect(row.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT');
    // The full authority story, on the persisted explanation:
    expect(row.explanation).toContain('CONTEXT_SCOPED_UNIT_ALIAS');
    expect(row.explanation).toContain('konteks tepercaya LABOR');
    expect(row.explanation).toContain('unit canonical PERSON_HOUR');
    expect(row.explanation).toContain('alias-jam-labor');
    // And the EQUIPMENT meaning of the same spelling was never borrowed.
    expect(row.explanation).not.toContain('alias-jam-equipment');
    expect(row.explanation).not.toContain('EQUIPMENT_HOUR');
  });

  it('5. specification safety still refuses AFTER unit context has settled the tie', async () => {
    // Unit context uniquely selects the m3 representation — and the
    // specification law then declines to assert it, because that catalog row
    // claims a diameter of 16 the AHSP line never stated. Cardinality was
    // solved; certainty was not, and RM-03D2 must not smuggle one past the other.
    const { resolutions } = await run([
      resource({ id: 'ahsp-angker', resourceId: 'Besi angker', baseUnit: 'm3' }),
    ]);
    const row = resolutions[0];

    expect(row.status).toBe('NEEDS_REVIEW');
    expect(row.resourceCatalogId).toBeNull();
    expect(row.selectedBasicPriceId).toBeNull();
    expect(row.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    // Never recorded as a settled identity, and never priced.
    expect(row.reasonCodes).not.toContain('EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT');
    expect(row.explanation).not.toContain('SIMPROK menghitung');
    // The tie story is STILL told truthfully — the reviewer sees that the unit
    // did its work and exactly which open question remains.
    expect(row.explanation).toContain('2 representasi');
    expect(row.explanation).toContain('unit canonical M3');
    expect(row.explanation).toContain('"16"');
    expect(row.explanation).toContain('penegasan manusia');
  });
});

describe('RM-03D2 — occurrence and RAB pre-lock cannot disagree', () => {
  it('the same evidence produces the identical verdict on every pass', async () => {
    // The pre-lock gate re-runs this very method on its own transaction and
    // compares the answer with the frozen one. If RM-03D2 were non-deterministic
    // or read anything outside the evidence, that comparison would fail lawful
    // locks — so determinism across passes IS the consistency property.
    const resources = [
      resource({ id: 'ahsp-mortar-m3', baseUnit: 'm3' }),
      resource({ id: 'ahsp-mortar-kg', baseUnit: 'kg' }),
    ];
    const occurrencePass = await run(resources);
    const prelockPass = await run(resources);

    expect(JSON.stringify(prelockPass.resolutions)).toBe(
      JSON.stringify(occurrencePass.resolutions),
    );
  });

  it('the RAB pre-lock gate owns NO identity logic of its own — it calls the one orchestrator', () => {
    // Same discipline as project-ahsp-occurrence-append-only.spec.ts: the
    // guarantee is structural, so it is asserted against the shipped source
    // rather than re-derived from behaviour.
    const source = readFileSync(
      join(__dirname, '..', 'project', 'rab-lock.service.ts'),
      'utf8',
    );

    expect(source).toContain('resolveVersionResources');
    // No second identity authority, and no direct kernel call.
    expect(source).not.toContain('resolveResourceIdentity');
    expect(source).not.toContain('ResourceIdentityResolutionService');
    expect(source).not.toContain('resolveCanonicalUnitIdentities');
  });

  it('the occurrence lineage lookup still scopes by resolutionPolicyVersion', () => {
    // RM-03D2 advanced E1A_RESOLUTION_POLICY_VERSION to V2, which makes it
    // tempting to "fix" the predecessor lookup so V2 occurrences chain onto V1
    // ones. That would be wrong: SIMPROK's occurrence law treats the policy as
    // part of the BUSINESS CONTEXT an occurrence answers for, so a V1 chain and
    // a V2 chain are lawfully separate generations and a V2 generation=1 is not
    // a regression.
    //
    // Asserted structurally because the guarantee is structural — the risk is a
    // future edit quietly dropping the field, which behaviour alone would not
    // catch until two policies coexisted in one workspace.
    const source = readFileSync(
      join(__dirname, 'project-ahsp.service.ts'),
      'utf8',
    );
    const lookup = source.slice(
      source.indexOf('projectAhspOccurrence.findFirst'),
      source.indexOf('orderBy: { generation:'),
    );

    expect(lookup).toContain('resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION');
  });
});
