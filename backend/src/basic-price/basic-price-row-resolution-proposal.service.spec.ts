/**
 * INT-CONNECT-01 — BASIC PRICE MACHINE-FIRST ACCEPTANCE (BP-INT-01..BP-INT-12, BP-INT-18).
 *
 * THE AUTHORITIES HERE ARE REAL, AND THAT IS THE POINT OF THE SUITE.
 *
 * `UnitKernelService` and `ResourceIdentityResolutionService` are constructed
 * for real, over an in-memory Prisma stand-in, so every verdict below is
 * produced by the SAME domain law production runs. Mocking them would have
 * proved only that this file can imagine an answer — and the defect this slice
 * exists to close was precisely that Basic Price never asked the real ones.
 *
 * A stubbed authority would also let a second matcher grow here unnoticed.
 * Against the real ones it cannot: if this file ever started deciding identity
 * or units itself, these tests would keep passing while the seam's own contract
 * silently forked. They are written so the authorities' answers, not this
 * file's, are what is asserted.
 */
import { PrismaService } from '../prisma/prisma.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import {
  ResourceIdentityResolutionService,
  type EvidenceClient,
} from '../resource-catalog/resource-identity-resolution.service';
import {
  BasicPriceRowResolutionProposalService,
  type BasicPriceRowMachineProposal,
} from './basic-price-row-resolution-proposal.service';

/* ---------------------------------------------------------------------------
 * THE STAND-IN'S OWN SHAPES, DECLARED RATHER THAN ASSUMED.
 *
 * The in-memory Prisma stand-in below answers a small, fixed set of reads. These
 * types say exactly which rows it holds and which WHERE clauses it honours, so
 * every value this suite reads off it is a named shape rather than an untyped
 * one. They describe THE FIXTURE, not the schema: only the columns the two real
 * authorities actually select appear here.
 * ------------------------------------------------------------------------- */

interface StubUnitDefinition {
  id: string;
  code: string;
  displayName: string;
  symbol: string;
  dimension: string;
  kind: string;
  isActive: boolean;
}

interface StubUnitAlias {
  id: string;
  normalizedAlias: string;
  context: string | null;
  unitDefinition: StubUnitDefinition;
}

interface StubResourceCatalogRow {
  id: string;
  /** Null means GLOBAL reference data — see the `cat-global-pasir` fixture. */
  workspaceId: string | null;
  code: string | null;
  name: string;
  type: string;
  baseUnit: string;
  status: string;
  specifications: Record<string, string> | null;
}

interface StubRowResourceMapping {
  id: string;
  workspaceId: string;
  resourceCatalogId: string;
  reviewerAccountId: string;
  decidedAt: Date;
  reason: string | null;
  row: {
    rawResourceNameText: string;
    rawResourceCodeText: string | null;
    resolvedResourceType: string;
    sourceSection: string;
  };
}

interface StubUnitAliasWhere {
  normalizedAlias?: string | { in?: string[] };
  isActive?: boolean;
  unitDefinition?: { is?: { isActive?: boolean } };
}

interface StubUnitDefinitionWhere {
  id?: { in?: string[] };
}

/**
 * ONE CLAUSE OF THE CATALOG `OR`, as a bag of column/value pairs. The stand-in
 * compares whatever columns the clause happens to name, which is what lets it
 * honour `{ OR: [{ workspaceId }, { workspaceId: null }] }` without knowing that
 * predicate by name.
 */
type StubCatalogOrClause = Record<string, string | null>;

interface StubResourceCatalogWhere {
  OR?: StubCatalogOrClause[];
  id?: { in?: string[] };
  workspaceId?: string | null;
  status?: string;
}

interface StubMappingWhere {
  workspaceId?: string;
}

/**
 * ONLY THE MODEL METHODS THESE STUBS IMPLEMENT — and that narrowness is itself
 * under test: BP-INT-12 proves no mutating capability exists here at all.
 */
interface PrismaStandIn {
  unitAlias: {
    findMany: (args: { where: StubUnitAliasWhere }) => Promise<StubUnitAlias[]>;
  };
  unitDefinition: {
    findMany: (args: {
      where?: StubUnitDefinitionWhere;
    }) => Promise<StubUnitDefinition[]>;
    findFirst: () => Promise<StubUnitDefinition | null>;
  };
  /** Asked about, never populated: this suite catalogues no conversion rule. */
  unitConversionRule: { findMany: (args?: unknown) => Promise<never[]> };
  resourceCatalog: {
    findMany: (args?: {
      where?: StubResourceCatalogWhere;
    }) => Promise<StubResourceCatalogRow[]>;
  };
  /** Likewise: no sighting is recorded anywhere in this suite. */
  resourceSourceIdentity: { findMany: (args?: unknown) => Promise<never[]> };
  basicPriceImportRowResourceMapping: {
    findMany: (args?: {
      where?: StubMappingWhere;
    }) => Promise<StubRowResourceMapping[]>;
  };
}

/** The args any of those reads may carry — the stand-in reads only `where`. */
interface CountedFindManyArgs {
  where?: unknown;
  select?: unknown;
  include?: unknown;
}

/**
 * ANY ONE OF THE READ MODELS BP-INT-18 COUNTS, described only as far as counting
 * needs it: a `findMany` that takes its caller's own args and answers rows. It is
 * a VIEW of a stand-in model, never a second shape — wrapping through it wraps
 * the same object the authorities read.
 */
interface CountedReadModel {
  findMany: (args?: CountedFindManyArgs) => Promise<unknown>;
}

/**
 * THE ONE BOUNDARY CAST, NAMED AND KEPT IN A SINGLE PLACE.
 *
 * The authorities are constructed for real, and their constructors take
 * `PrismaService`. The stand-in implements exactly the reads they issue and
 * nothing else, so the crossing happens HERE, once — and every read in the suite
 * below stays typed instead of decaying into `any` the moment it is touched.
 */
const asPrismaClient = (standIn: PrismaStandIn): PrismaService =>
  standIn as unknown as PrismaService;

/**
 * The private seam method CASE 5 and CASE 6 exercise directly, described by the
 * only facts those tests use: the client it reads through, and the one field it
 * reads off each proposed resource.
 */
interface ProposalServiceInternals {
  admissibleCatalogIds: (
    client: EvidenceClient,
    workspaceId: string,
    resources: ReadonlyArray<{ resourceCatalogId: string | null }>,
  ) => Promise<ReadonlySet<string>>;
}

const internalsOf = (
  service: BasicPriceRowResolutionProposalService,
): ProposalServiceInternals => service as unknown as ProposalServiceInternals;

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_WORKSPACE = '99999999-9999-4999-8999-999999999999';

const UNIT: Record<
  'LITER' | 'KG' | 'PERSON_HOUR' | 'EQUIPMENT_HOUR' | 'ORPHAN',
  StubUnitDefinition
> = {
  LITER: {
    id: 'unit-liter',
    code: 'LITER',
    displayName: 'Litre',
    symbol: 'liter',
    dimension: 'VOLUME',
    kind: 'CANONICAL',
    isActive: true,
  },
  KG: {
    id: 'unit-kg',
    code: 'KG',
    displayName: 'Kilogram',
    symbol: 'kg',
    dimension: 'MASS',
    kind: 'CANONICAL',
    isActive: true,
  },
  PERSON_HOUR: {
    id: 'unit-person-hour',
    code: 'PERSON_HOUR',
    displayName: 'Person hour',
    symbol: 'jam-orang',
    dimension: 'PERSON_TIME',
    kind: 'CANONICAL',
    isActive: true,
  },
  EQUIPMENT_HOUR: {
    id: 'unit-equipment-hour',
    code: 'EQUIPMENT_HOUR',
    displayName: 'Equipment hour',
    symbol: 'jam-alat',
    dimension: 'EQUIPMENT_TIME',
    kind: 'CANONICAL',
    isActive: true,
  },
  /** Deliberately has NO alias for its own code — see BP-INT-04. */
  ORPHAN: {
    id: 'unit-orphan',
    code: 'ORPHAN',
    displayName: 'Orphan',
    symbol: 'orp',
    dimension: 'COUNT',
    kind: 'CANONICAL',
    isActive: true,
  },
};

/** rawAlias/normalizedAlias/context/unitDefinition — the real alias table shape. */
const ALIASES: StubUnitAlias[] = [
  {
    id: 'a-ltr',
    normalizedAlias: 'ltr',
    context: null,
    unitDefinition: UNIT.LITER,
  },
  {
    id: 'a-liter',
    normalizedAlias: 'liter',
    context: null,
    unitDefinition: UNIT.LITER,
  },
  { id: 'a-kg', normalizedAlias: 'kg', context: null, unitDefinition: UNIT.KG },
  // Two meanings for one spelling, separated only by governed context.
  {
    id: 'a-jam-labor',
    normalizedAlias: 'jam',
    context: 'LABOR',
    unitDefinition: UNIT.PERSON_HOUR,
  },
  {
    id: 'a-jam-equipment',
    normalizedAlias: 'jam',
    context: 'EQUIPMENT',
    unitDefinition: UNIT.EQUIPMENT_HOUR,
  },
  {
    id: 'a-person-hour',
    normalizedAlias: 'person_hour',
    context: null,
    unitDefinition: UNIT.PERSON_HOUR,
  },
  {
    id: 'a-equipment-hour',
    normalizedAlias: 'equipment_hour',
    context: null,
    unitDefinition: UNIT.EQUIPMENT_HOUR,
  },
  // "sak" identifies ORPHAN, whose own canonical code has no alias at all.
  {
    id: 'a-sak',
    normalizedAlias: 'sak',
    context: null,
    unitDefinition: UNIT.ORPHAN,
  },
];

const CATALOG: StubResourceCatalogRow[] = [
  {
    id: 'cat-air',
    workspaceId: WORKSPACE,
    code: null,
    name: 'Air',
    type: 'MATERIAL',
    baseUnit: 'Liter',
    status: 'ACTIVE',
    specifications: null,
  },
  {
    id: 'cat-semen-a',
    workspaceId: WORKSPACE,
    code: 'M.01',
    name: 'Semen',
    type: 'MATERIAL',
    baseUnit: 'Kg',
    status: 'ACTIVE',
    specifications: null,
  },
  {
    id: 'cat-semen-b',
    workspaceId: WORKSPACE,
    code: 'M.02',
    name: 'Semen',
    type: 'MATERIAL',
    baseUnit: 'Kg',
    status: 'ACTIVE',
    specifications: null,
  },
  {
    id: 'cat-pekerja',
    workspaceId: WORKSPACE,
    code: 'L.01',
    name: 'Pekerja',
    type: 'LABOR',
    baseUnit: 'PERSON_HOUR',
    status: 'ACTIVE',
    specifications: null,
  },
  /**
   * GLOBAL reference data — `workspaceId: null`. The shared Resource Identity
   * authority legitimately sees it (AHSP occurrence resolution resolves against
   * global rows), but Basic Price's own resolve endpoint does not: it looks the
   * chosen row up with strict workspace equality. This fixture exists so that
   * gap is TESTED rather than assumed absent.
   */
  {
    id: 'cat-global-pasir',
    workspaceId: null,
    code: 'G.01',
    name: 'Pasir Beton',
    type: 'MATERIAL',
    baseUnit: 'M3',
    status: 'ACTIVE',
    specifications: null,
  },
  /**
   * ANOTHER TENANT'S ROW, deliberately given a name that would match EXACTLY if
   * the tenant predicate ever slipped. "Air" is the Owner's own row name, so this
   * is the most dangerous shape available: a silent widening would turn a
   * one-candidate exact match into a two-row ambiguity, or worse, resolve to the
   * wrong tenant's identity. It must be invisible from WORKSPACE.
   */
  {
    id: 'cat-foreign-air',
    workspaceId: FOREIGN_WORKSPACE,
    code: 'X.99',
    name: 'Air',
    type: 'MATERIAL',
    baseUnit: 'Liter',
    status: 'ACTIVE',
    specifications: null,
  },
];

/**
 * Reviewed human decisions. The FOREIGN one names a catalog row this workspace
 * CAN see (the global row), which is exactly the leak worth testing: tenant
 * safety here cannot come from the candidate being invisible, only from the
 * mapping query's own strict workspace predicate.
 */
const MAPPINGS: StubRowResourceMapping[] = [
  {
    id: 'map-foreign',
    workspaceId: FOREIGN_WORKSPACE,
    resourceCatalogId: 'cat-global-pasir',
    reviewerAccountId: 'foreign-reviewer',
    decidedAt: new Date('2026-01-01T00:00:00.000Z'),
    reason: 'RAHASIA TENANT LAIN',
    row: {
      rawResourceNameText: 'Pasir Beton',
      rawResourceCodeText: null,
      resolvedResourceType: 'MATERIAL',
      sourceSection: 'MATERIAL',
    },
  },
];

function createPrisma(
  catalog: StubResourceCatalogRow[] = CATALOG,
): PrismaStandIn {
  const matchAlias = (where: StubUnitAliasWhere) => {
    const wanted: string[] =
      typeof where.normalizedAlias === 'string'
        ? [where.normalizedAlias]
        : (where.normalizedAlias?.in ?? []);
    return ALIASES.filter(
      (alias) =>
        wanted.includes(alias.normalizedAlias) && alias.unitDefinition.isActive,
    );
  };
  /**
   * The catalog stand-in HONOURS ITS WHERE CLAUSE, and it has to.
   *
   * Two different predicates hit this model: `loadEvidence` asks for
   * `{ OR: [{ workspaceId }, { workspaceId: null }] }` and the proposal seam's
   * admissibility check asks for `{ id: { in }, workspaceId, status }`. A stub
   * that ignored the clause and returned everything would make the second query
   * look like it passed for rows it must reject — the exact defect under test.
   */
  const matchCatalog = (where: StubResourceCatalogWhere = {}) =>
    catalog.filter((rowValue) => {
      if (Array.isArray(where.OR)) {
        const ok = where.OR.some((clause) =>
          Object.entries(clause).every(
            ([key, value]) =>
              rowValue[key as keyof StubResourceCatalogRow] === value,
          ),
        );
        if (!ok) return false;
      }
      if (where.id?.in && !where.id.in.includes(rowValue.id)) return false;
      if ('workspaceId' in where && rowValue.workspaceId !== where.workspaceId)
        return false;
      if ('status' in where && rowValue.status !== where.status) return false;
      return true;
    });
  return {
    unitAlias: {
      findMany: ({ where }: { where: StubUnitAliasWhere }) =>
        Promise.resolve(matchAlias(where)),
    },
    unitDefinition: {
      findMany: ({ where }: { where?: StubUnitDefinitionWhere }) =>
        Promise.resolve(
          Object.values(UNIT).filter((u) =>
            (where?.id?.in ?? []).includes(u.id),
          ),
        ),
      findFirst: () => Promise.resolve(null),
    },
    unitConversionRule: { findMany: () => Promise.resolve([]) },
    resourceCatalog: {
      findMany: ({ where }: { where?: StubResourceCatalogWhere } = {}) =>
        Promise.resolve(matchCatalog(where)),
    },
    resourceSourceIdentity: { findMany: () => Promise.resolve([]) },
    /**
     * HONOURS `where.workspaceId` — and it has to, for the same reason the
     * catalog stub does. This is where `priorHumanDecision` evidence comes from,
     * so a stub that ignored the clause would make a foreign tenant's recorded
     * decision look tenant-safe in every test.
     */
    basicPriceImportRowResourceMapping: {
      findMany: ({ where }: { where?: StubMappingWhere } = {}) =>
        Promise.resolve(
          MAPPINGS.filter(
            (m) =>
              !('workspaceId' in where!) || m.workspaceId === where.workspaceId,
          ),
        ),
    },
  };
}

function createService(catalog?: StubResourceCatalogRow[]) {
  const prisma = asPrismaClient(createPrisma(catalog));
  const units = new UnitKernelService(prisma);
  const identity = new ResourceIdentityResolutionService(prisma, units);
  return new BasicPriceRowResolutionProposalService(prisma, units, identity);
}

/** The row shape the seam accepts, read off the seam's own signature. */
type ProposalRow = Parameters<
  BasicPriceRowResolutionProposalService['proposeForRows']
>[1][number];

const row = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  id: 'row-1',
  sourceSection: 'MATERIAL',
  rawResourceNameText: 'Air',
  rawResourceCodeText: null,
  rawUnitText: 'ltr',
  ...over,
});

const proposeOne = async (
  input: ReturnType<typeof row>,
  catalog?: StubResourceCatalogRow[],
) =>
  (await createService(catalog).proposeForRows(WORKSPACE, [input])).get(
    input.id,
  )!;

describe('BP-INT-01 — an exact safe unit match becomes an automatic canonical unit', () => {
  it("proves the Owner's own row: Air / MATERIAL / 'ltr'", async () => {
    const proposal = await proposeOne(row());

    expect(proposal.unit.status).toBe('RESOLVED');
    expect(proposal.unit.unitDefinitionId).toBe(UNIT.LITER.id);
    expect(proposal.unit.unitCode).toBe('LITER');
    // The reason travels with the answer — an automatic result that cannot
    // explain itself is not accountable. What travels is the NAMED CODE and the
    // readable unit, not a prose sentence: the reviewer's sentence is composed
    // from these facts on the frontend, which is the one narrative there is.
    expect(proposal.unit.reasonCode).toBe('EXACT_UNIT_IDENTITY');
    expect(proposal.unit.unitDisplayName).toBe('Litre');
  });

  it('uses the row governed class as unit context, so one spelling can mean two units', async () => {
    const labour = await proposeOne(
      row({
        id: 'r-l',
        sourceSection: 'LABOR',
        rawResourceNameText: 'Pekerja',
        rawUnitText: 'jam',
      }),
    );
    const plant = await proposeOne(
      row({
        id: 'r-e',
        sourceSection: 'EQUIPMENT',
        rawResourceNameText: 'Excavator',
        rawUnitText: 'jam',
      }),
    );

    expect(labour.unit.unitDefinitionId).toBe(UNIT.PERSON_HOUR.id);
    expect(plant.unit.unitDefinitionId).toBe(UNIT.EQUIPMENT_HOUR.id);
    // Provenance says the meaning is context-bound, never globally unambiguous.
    expect(labour.unit.contextScoped).toBe(true);
    expect(labour.unit.trustedContext).toBe('LABOR');
  });
});

describe('BP-INT-02 — an ambiguous unit is never chosen automatically', () => {
  it('leaves "jam" unresolved when the row has no governed class to read it under', async () => {
    const proposal = await proposeOne(
      row({
        sourceSection: null,
        rawResourceNameText: 'Sesuatu',
        rawUnitText: 'jam',
      }),
    );

    expect(proposal.unit.unitDefinitionId).toBeNull();
    // The authority's own distinction, carried through untouched: "jam" has TWO
    // catalogued meanings, so without a governed class it is AMBIGUOUS — not
    // merely context-required, which is what a single context-scoped meaning
    // would have been. The seam reports whichever the authority gave; it does
    // not flatten the two into one "could not resolve".
    expect(proposal.unit.reasonCode).toBe('AMBIGUOUS_UNIT_ALIAS');
    expect(proposal.identityPairProven).toBe(false);
    expect(proposal.blockingFacts).toContain('AMBIGUOUS_UNIT_ALIAS');
  });
});

describe('BP-INT-03 — an unknown unit stays unresolved and nothing is fabricated', () => {
  it('refuses "bh", and says it is unknown rather than inventing a meaning', async () => {
    const proposal = await proposeOne(row({ rawUnitText: 'bh' }));

    expect(proposal.unit.status).toBe('NEEDS_REVIEW');
    expect(proposal.unit.unitDefinitionId).toBeNull();
    expect(proposal.unit.unitCode).toBeNull();
    expect(proposal.unit.reasonCode).toBe('UNKNOWN_UNIT_ALIAS');
    expect(proposal.identityPairProven).toBe(false);
  });

  it('never consults the authority about a source row that stated no unit at all', async () => {
    const proposal = await proposeOne(row({ rawUnitText: null }));

    expect(proposal.unit.status).toBe('NOT_STATED');
    // The intake's OWN existing code for this fact — not a new vocabulary.
    expect(proposal.unit.reasonCode).toBe('UNIT_REQUIRED');
    expect(proposal.blockingFacts).toContain('UNIT_REQUIRED');
  });
});

describe('BP-INT-04 — a unit the authority cannot represent fails closed', () => {
  it('refuses a canonical unit whose own code carries no alias the kernel can see', async () => {
    // "sak" IDENTIFIES ORPHAN, but the resolve endpoint proves a chosen unit by
    // its canonical CODE, and ORPHAN has no alias for "ORPHAN". Offering it
    // would hand the reviewer a pre-filled choice the backend then rejects.
    const proposal = await proposeOne(row({ rawUnitText: 'sak' }));

    expect(proposal.unit.status).toBe('RESOLVED');
    expect(proposal.unit.unitDefinitionId).toBeNull();
    expect(proposal.unit.reasonCode).toBe(
      'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY',
    );
    expect(proposal.identityPairProven).toBe(false);
  });
});

describe('BP-INT-05 — an exact resource identity is proven by the canonical authority', () => {
  it('resolves "Air" to the one active MATERIAL of that name, with its authority named', async () => {
    const proposal = await proposeOne(row());

    expect(proposal.resource.status).toBe('RESOLVED');
    expect(proposal.resource.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(proposal.resource.resourceCatalogId).toBe('cat-air');
    expect(proposal.resource.resourceName).toBe('Air');
    expect(proposal.identityPairProven).toBe(true);
    expect(proposal.blockingFacts).toEqual([]);
  });
});

describe('BP-INT-06 — several equal candidates never become an automatic identity', () => {
  it('holds "Semen" for a human when two catalog rows match name and type exactly', async () => {
    const proposal = await proposeOne(
      row({ rawResourceNameText: 'Semen', rawUnitText: 'kg' }),
    );

    expect(proposal.resource.resourceCatalogId).toBeNull();
    expect(proposal.resource.candidates.length).toBeGreaterThan(1);
    expect(proposal.identityPairProven).toBe(false);
    // The unit leg is untouched by the identity leg's uncertainty.
    expect(proposal.unit.unitDefinitionId).toBe(UNIT.KG.id);
  });
});

describe('BP-INT-07 — no candidate at all is a human exception, not a guess', () => {
  it('says RESOURCE_NOT_FOUND rather than binding the nearest row', async () => {
    const proposal = await proposeOne(
      row({ rawResourceNameText: 'Bahan Yang Tidak Ada Di Katalog' }),
    );

    expect(proposal.resource.status).toBe('UNRESOLVED');
    expect(proposal.resource.resourceCatalogId).toBeNull();
    expect(proposal.resource.reasonCodes).toContain('RESOURCE_NOT_FOUND');
    expect(proposal.identityPairProven).toBe(false);
  });
});

describe('BP-INT-08 — a missing source code alone never forces manual identity', () => {
  it("resolves the Owner's code-less row from name, class and unit evidence", async () => {
    const proposal = await proposeOne(row({ rawResourceCodeText: null }));

    // The row carries RESOURCE_CODE_MISSING as an intake warning. It gates
    // nothing: identity is proven from the evidence that does exist.
    expect(proposal.resource.status).toBe('RESOLVED');
    expect(proposal.identityPairProven).toBe(true);
  });
});

describe('BP-INT-09 — an unknown category stays a visible exception and invents nothing', () => {
  it('does not ask the identity authority at all when sourceSection is null', async () => {
    const proposal = await proposeOne(
      row({ sourceSection: null, rawResourceNameText: 'Air' }),
    );

    expect(proposal.resource.status).toBe('UNRESOLVED');
    expect(proposal.resource.resourceCatalogId).toBeNull();
    expect(proposal.resource.candidates).toEqual([]);
    expect(proposal.resource.reasonCodes).toEqual([
      'ROW_SOURCE_SECTION_UNRESOLVED',
    ]);
    expect(proposal.blockingFacts).toContain('ROW_SOURCE_SECTION_UNRESOLVED');
    // The refusal is NAMED, and the naming is the whole outward answer. The
    // sentence a non-programmer reads is built from this code by the frontend's
    // presentation law, so nothing here needs to carry prose.
    expect(proposal.resource).not.toHaveProperty('explanation');
  });

  it('still proves the unit for such a row, using context-free meanings only', async () => {
    const proposal = await proposeOne(
      row({ sourceSection: null, rawUnitText: 'ltr' }),
    );

    // One unknown fact does not blind SIMPROK to the facts it does hold.
    expect(proposal.unit.unitDefinitionId).toBe(UNIT.LITER.id);
    expect(proposal.unit.contextScoped).toBe(false);
    expect(proposal.identityPairProven).toBe(false);
  });
});

describe('BP-INT-10 — one unresolved row never stops its healthy siblings', () => {
  it('proves the good rows in a batch that also contains broken ones', async () => {
    const service = createService();
    const proposals = await service.proposeForRows(WORKSPACE, [
      row({ id: 'ok' }),
      row({ id: 'bad-unit', rawUnitText: 'bh' }),
      row({ id: 'bad-name', rawResourceNameText: 'Entah Apa' }),
      row({ id: 'bad-section', sourceSection: null }),
      row({
        id: 'ok-2',
        rawResourceNameText: 'Pekerja',
        sourceSection: 'LABOR',
        rawUnitText: 'jam',
      }),
    ]);

    expect(proposals.get('ok')!.identityPairProven).toBe(true);
    expect(proposals.get('ok-2')!.identityPairProven).toBe(true);
    expect(proposals.get('bad-unit')!.identityPairProven).toBe(false);
    expect(proposals.get('bad-name')!.identityPairProven).toBe(false);
    expect(proposals.get('bad-section')!.identityPairProven).toBe(false);
    expect(proposals.size).toBe(5);
  });
});

describe('BP-INT-12 — the machine proposes and never impersonates a decision', () => {
  it('writes nothing: the seam has no mutating Prisma capability at all', async () => {
    const standIn = createPrisma();
    // Any write would have to go through one of these. They do not exist on the
    // stand-in, so a write attempt throws rather than silently succeeding.
    //
    // Asked through a bare model-bag view of the SAME object: absence cannot be
    // asked about through a type that only names what is present.
    const models = standIn as unknown as Record<
      string,
      { update?: unknown; create?: unknown } | undefined
    >;
    for (const model of [
      'basicPriceImportRow',
      'basicPriceImportRowResourceMapping',
    ]) {
      expect(models[model]?.update).toBeUndefined();
      expect(models[model]?.create).toBeUndefined();
    }
    const prisma = asPrismaClient(standIn);
    const units = new UnitKernelService(prisma);
    const identity = new ResourceIdentityResolutionService(prisma, units);
    const service = new BasicPriceRowResolutionProposalService(
      prisma,
      units,
      identity,
    );

    await expect(
      service.proposeForRows(WORKSPACE, [row()]),
    ).resolves.toBeDefined();
  });

  it('carries the policy version of each authority, so an answer can be dated', async () => {
    const proposal = await proposeOne(row());
    expect(proposal.unit.policyVersion).toBe('KAMUS_UNIT_KERNEL_01A_V1');
    expect(proposal.resource.policyVersion).toBe(
      'RM03D2_RESOURCE_IDENTITY_EVIDENCE_V2',
    );
  });
});

describe('BP-INT-18 — no second authority, and no ROW-LINEAR N+1', () => {
  /**
   * WHAT THIS PROVES, AND WHAT IT DOES NOT.
   *
   * PROVES: for a fixture of a given SHAPE — a fixed set of distinct governed
   * contexts, distinct unit spellings and distinct proposed identities —
   * multiplying the ROW COUNT by a hundred does not add a single query. That is
   * the absence of row-linear N+1, which is the defect that matters at 86 rows
   * and at 8600.
   *
   * DOES NOT PROVE: that the query count is a universal constant. It is not, and
   * claiming so would be an overclaim. The work is bounded by the EVIDENCE, not
   * by the rows: more distinct governed contexts, more distinct spellings, more
   * distinct canonical codes, more distinct proposed catalog ids, or the identity
   * authority's rare representation-tie path meeting new spellings, will each add
   * bounded work. The second test below shows exactly that, so the boundary
   * between the two claims is itself tested rather than asserted in a comment.
   */
  it('does not grow with row count for a fixture of fixed shape', async () => {
    const counts = async (rowCount: number) => {
      const standIn = createPrisma();
      let queries = 0;
      // Generic rather than `any`: each wrapped read keeps its own args and its
      // own answer type, so wrapping cannot quietly change what a model returns.
      const count =
        <A, R>(fn: (args: A) => R) =>
        (args: A): R => {
          queries += 1;
          return fn(args);
        };
      standIn.unitAlias.findMany = count(standIn.unitAlias.findMany);
      standIn.unitDefinition.findMany = count(standIn.unitDefinition.findMany);
      standIn.resourceCatalog.findMany = count(
        standIn.resourceCatalog.findMany,
      );
      standIn.resourceSourceIdentity.findMany = count(
        standIn.resourceSourceIdentity.findMany,
      );
      standIn.basicPriceImportRowResourceMapping.findMany = count(
        standIn.basicPriceImportRowResourceMapping.findMany,
      );
      const prisma = asPrismaClient(standIn);
      const units = new UnitKernelService(prisma);
      const identity = new ResourceIdentityResolutionService(prisma, units);
      const service = new BasicPriceRowResolutionProposalService(
        prisma,
        units,
        identity,
      );

      // A realistic mixture: three governed classes and several spellings.
      const rows = Array.from({ length: rowCount }, (_, index) =>
        index % 3 === 0
          ? row({ id: `r${index}` })
          : index % 3 === 1
            ? row({
                id: `r${index}`,
                rawResourceNameText: 'Pekerja',
                sourceSection: 'LABOR',
                rawUnitText: 'jam',
              })
            : row({
                id: `r${index}`,
                rawResourceNameText: 'Semen',
                rawUnitText: 'kg',
              }),
      );
      await service.proposeForRows(WORKSPACE, rows);
      return queries;
    };

    const small = await counts(6);
    const large = await counts(600);

    // IDENTICAL for this shape: 6 rows and 600 rows of the same three shapes
    // issue the same queries, so ROW COUNT does not enter the query count.
    expect(large).toBe(small);
    expect(large).toBeLessThanOrEqual(10);
  });

  it('grows with DISTINCT EVIDENCE, not with rows — and that is the honest bound', async () => {
    const countFor = async (rows: ReturnType<typeof row>[]) => {
      const standIn = createPrisma();
      let queries = 0;
      for (const model of [
        'unitAlias',
        'unitDefinition',
        'resourceCatalog',
        'resourceSourceIdentity',
        'basicPriceImportRowResourceMapping',
      ] as const) {
        // A VIEW of the same model object, describing only what the counting
        // needs: a `findMany` taking its caller's args and answering rows.
        const counted: CountedReadModel = standIn[model];
        const inner = counted.findMany;
        counted.findMany = (args) => {
          queries += 1;
          return inner(args);
        };
      }
      const prisma = asPrismaClient(standIn);
      const units = new UnitKernelService(prisma);
      const identity = new ResourceIdentityResolutionService(prisma, units);
      const service = new BasicPriceRowResolutionProposalService(
        prisma,
        units,
        identity,
      );
      await service.proposeForRows(WORKSPACE, rows);
      return queries;
    };

    // Same row count, but the second batch spans three governed contexts instead
    // of one — so the unit authority is asked once per context rather than once.
    const oneContext = await countFor([
      row({ id: 'a' }),
      row({ id: 'b', rawResourceNameText: 'Semen', rawUnitText: 'kg' }),
      row({ id: 'c', rawResourceNameText: 'Semen', rawUnitText: 'kg' }),
    ]);
    const threeContexts = await countFor([
      row({ id: 'a' }),
      row({
        id: 'b',
        rawResourceNameText: 'Pekerja',
        sourceSection: 'LABOR',
        rawUnitText: 'jam',
      }),
      row({
        id: 'c',
        rawResourceNameText: 'Excavator',
        sourceSection: 'EQUIPMENT',
        rawUnitText: 'jam',
      }),
    ]);

    expect(threeContexts).toBeGreaterThan(oneContext);
    // Still bounded, and bounded by the evidence: at most one unit-identity call
    // per governed context, plus the fixed reads.
    expect(threeContexts - oneContext).toBeLessThanOrEqual(3);
  });
});

describe('BP-INT-19 — an actionable proposal is never wider than what resolveRow accepts', () => {
  it('keeps a workspace-owned exact match both resolved AND admissible', async () => {
    const proposal = await proposeOne(row());

    expect(proposal.resource.status).toBe('RESOLVED');
    expect(proposal.resource.admissibleForResolve).toBe(true);
    expect(proposal.identityPairProven).toBe(true);
    expect(proposal.blockingFacts).toEqual([]);
  });

  it('refuses to make a GLOBAL identity actionable, under the endpoint own refusal code', async () => {
    // The shared authority sees `{ OR: [{ workspaceId }, { workspaceId: null }] }`
    // and will happily prove "Pasir Beton" against the global row — that answer is
    // TRUE. But BasicPriceRowResolutionService looks the chosen row up with
    // `{ id, workspaceId, status: 'ACTIVE' }`, strict equality, so pre-filling it
    // would hand the reviewer a selection the endpoint answers 409 to.
    const proposal = await proposeOne(
      row({ rawResourceNameText: 'Pasir Beton', rawUnitText: 'kg' }),
    );

    // The authority's verdict is carried VERBATIM — it is not falsified.
    expect(proposal.resource.status).toBe('RESOLVED');
    expect(proposal.resource.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(proposal.resource.resourceCatalogId).toBe('cat-global-pasir');
    // …but Basic Price may not act on it, and says so in the endpoint's own words.
    expect(proposal.resource.admissibleForResolve).toBe(false);
    expect(proposal.identityPairProven).toBe(false);
    expect(proposal.blockingFacts).toContain(
      'RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE',
    );
  });

  it('leaves the shared authority untouched — the narrowing lives only in this seam', async () => {
    // Discovery evidence stays rich: the global row is still found, still named,
    // still explained. Only actionability is refused. Narrowing `loadEvidence`
    // instead would have silently changed what AHSP occurrence resolution can
    // resolve, which is a different domain's law.
    const proposal = await proposeOne(
      row({ rawResourceNameText: 'Pasir Beton', rawUnitText: 'kg' }),
    );
    expect(proposal.resource.resourceName).toBe('Pasir Beton');
    expect(proposal.resource.reasonCodes).toContain('EXACT_CANONICAL_MATCH');
  });

  it('asks the admissibility question ONCE for the distinct ids, not once per row', async () => {
    const standIn = createPrisma();
    const calls: (StubResourceCatalogWhere | undefined)[] = [];
    const inner = standIn.resourceCatalog.findMany;
    standIn.resourceCatalog.findMany = (args) => {
      calls.push(args?.where);
      return inner(args);
    };
    const prisma = asPrismaClient(standIn);
    const units = new UnitKernelService(prisma);
    const identity = new ResourceIdentityResolutionService(prisma, units);
    const service = new BasicPriceRowResolutionProposalService(
      prisma,
      units,
      identity,
    );

    await service.proposeForRows(WORKSPACE, [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ id: 'c' }),
    ]);

    // The one query carrying an `id: { in }` predicate IS the admissibility
    // question; the narrowing here only names that fact for the reads below.
    const admissibility = calls.filter(
      (where): where is StubResourceCatalogWhere & { id: { in: string[] } } =>
        Boolean(where?.id?.in),
    );
    expect(admissibility).toHaveLength(1);
    // Exactly the predicate resolveWithinTransaction applies.
    expect(admissibility[0]).toMatchObject({
      workspaceId: WORKSPACE,
      status: 'ACTIVE',
    });
    // Distinct ids only — three rows proposing one identity ask about one id.
    expect(admissibility[0].id.in).toEqual(['cat-air']);
  });

  it('asks nothing at all when the authority proposed no identity in the batch', async () => {
    const standIn = createPrisma();
    const calls: (StubResourceCatalogWhere | undefined)[] = [];
    const inner = standIn.resourceCatalog.findMany;
    standIn.resourceCatalog.findMany = (args) => {
      calls.push(args?.where);
      return inner(args);
    };
    const prisma = asPrismaClient(standIn);
    const units = new UnitKernelService(prisma);
    const identity = new ResourceIdentityResolutionService(prisma, units);
    const service = new BasicPriceRowResolutionProposalService(
      prisma,
      units,
      identity,
    );

    await service.proposeForRows(WORKSPACE, [
      row({ id: 'x', rawResourceNameText: 'Tidak Ada Di Katalog' }),
    ]);

    expect(calls.filter((where) => where?.id?.in)).toHaveLength(0);
  });
});

describe('BP-INT-20 — identityPairProven names the identity pair, never the finished row', () => {
  it('reports the pair as proven for BOTH rows that would collide with each other', async () => {
    // A collision is a fact about a BATCH and about a decision that has not
    // happened yet. resolveRow computes it AFTER accepting the identity pair, and
    // may then leave the row NEEDS_REVIEW with SAME_IDENTITY_*. The proposal must
    // not pretend to judge that — and this test is what stops the name drifting
    // back toward "the row is complete".
    const service = createService();
    const proposals = await service.proposeForRows(WORKSPACE, [
      row({ id: 'first' }),
      row({ id: 'second' }),
    ]);

    expect(proposals.get('first')!.identityPairProven).toBe(true);
    expect(proposals.get('second')!.identityPairProven).toBe(true);
    expect(proposals.get('first')!.resource.resourceCatalogId).toBe(
      proposals.get('second')!.resource.resourceCatalogId,
    );
  });

  it('claims nothing about price: a row with no price still reports its identity truthfully', async () => {
    // `proposedCanonicalPrice` is not an input to this seam at all — the row
    // shape it accepts does not carry one. That absence is the guarantee: the
    // proposal cannot accidentally start predicting a lifecycle outcome from a
    // fact it never sees.
    const proposal = await proposeOne(row());
    expect(Object.keys(proposal)).toEqual([
      'rowId',
      'unit',
      'resource',
      'identityPairProven',
      'blockingFacts',
    ]);
  });
});

describe('INT-CONNECT-01 — the proposal is deterministic at ROW level, not merely in aggregate', () => {
  /**
   * TWO DIGESTS, BECAUSE THEY PROVE TWO DIFFERENT THINGS.
   *
   * `verdictOf` is the SEMANTIC content of one row's answer and deliberately
   * EXCLUDES `rowId`. `digest` is that content bound to the row it belongs to.
   *
   * The distinction is load-bearing and an earlier version of this suite got it
   * wrong: it counted DISTINCT full digests and concluded the fixture exercised
   * many different outcomes. That conclusion was unearned — every rowId differs,
   * so the full digests were guaranteed to differ whatever the verdicts were.
   * Outcome diversity has to be measured on the verdict alone.
   *
   * Aggregate tallies repeating is likewise a weak proof: two runs could swap
   * which rows hold which verdict and still tally identically. Binding the
   * verdict to its row is what rules that out.
   */
  const verdictOf = (proposal: BasicPriceRowMachineProposal) =>
    JSON.stringify({
      unit: {
        status: proposal.unit.status,
        unitDefinitionId: proposal.unit.unitDefinitionId,
        unitCode: proposal.unit.unitCode,
        reasonCode: proposal.unit.reasonCode,
        contextScoped: proposal.unit.contextScoped,
        trustedContext: proposal.unit.trustedContext,
        policyVersion: proposal.unit.policyVersion,
      },
      resource: {
        status: proposal.resource.status,
        authority: proposal.resource.authority,
        resourceCatalogId: proposal.resource.resourceCatalogId,
        admissibleForResolve: proposal.resource.admissibleForResolve,
        reasonCodes: proposal.resource.reasonCodes,
        policyVersion: proposal.resource.policyVersion,
        // ORDER INCLUDED ON PURPOSE: a candidate list that reorders between reads
        // would change what the reviewer sees first, so its order is part of the
        // verdict and must be stable.
        candidates: proposal.resource.candidates.map((c) => ({
          resourceCatalogId: c.resourceCatalogId,
          name: c.name,
          evidence: c.evidence,
          specificationUnproved: c.specificationUnproved,
          unprovedSpecificationFacts: c.unprovedSpecificationFacts,
          hasPriorHumanDecision: c.hasPriorHumanDecision,
        })),
      },
      identityPairProven: proposal.identityPairProven,
      blockingFacts: proposal.blockingFacts,
    });

  /** The verdict BOUND to the row it belongs to. */
  const digest = (proposal: BasicPriceRowMachineProposal) =>
    JSON.stringify({ rowId: proposal.rowId, verdict: verdictOf(proposal) });

  const MIXED = [
    row({ id: 'r1' }),
    row({ id: 'r2', rawResourceNameText: 'Semen', rawUnitText: 'kg' }),
    row({
      id: 'r3',
      rawResourceNameText: 'Pekerja',
      sourceSection: 'LABOR',
      rawUnitText: 'jam',
    }),
    row({ id: 'r4', rawResourceNameText: 'Pasir Beton', rawUnitText: 'kg' }),
    row({ id: 'r5', rawUnitText: 'bh' }),
    row({ id: 'r6', sourceSection: null, rawUnitText: 'ltr' }),
    row({
      id: 'r7',
      rawResourceNameText: 'Tidak Dikenal Sama Sekali',
      rawUnitText: 'sak',
    }),
  ];

  it('produces byte-identical per-row verdicts across two independent reads', async () => {
    const runOnce = async () => {
      const proposals = await createService().proposeForRows(WORKSPACE, MIXED);
      return [...proposals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, proposal]) => digest(proposal));
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(first).toHaveLength(MIXED.length);
    expect(second).toEqual(first);
  });

  it('is measured on a fixture that genuinely reaches several DIFFERENT verdicts', async () => {
    // Guards the test above from becoming vacuous. Measured on `verdictOf`, which
    // excludes rowId — counting distinct FULL digests would prove nothing, since
    // seven different rowIds guarantee seven different full digests whatever the
    // verdicts are.
    const proposals = await createService().proposeForRows(WORKSPACE, MIXED);
    const verdicts = [...proposals.values()];
    const distinctVerdicts = new Set(verdicts.map(verdictOf)).size;

    expect(distinctVerdicts).toBeGreaterThan(1);
    // And the diversity spans both sides of the boundary that matters.
    expect(verdicts.some((p) => p.identityPairProven)).toBe(true);
    expect(verdicts.some((p) => !p.identityPairProven)).toBe(true);
    // Several distinct REASONS, not one failure repeated.
    expect(
      new Set(verdicts.flatMap((p) => p.blockingFacts)).size,
    ).toBeGreaterThan(2);
  });

  it('is insensitive to the ORDER the rows arrive in', async () => {
    // Two callers reading the same batch must get the same verdict per row even
    // if row order differed — otherwise a re-read could silently change what a
    // reviewer is told about one row.
    const forwards = await createService().proposeForRows(WORKSPACE, MIXED);
    const backwards = await createService().proposeForRows(
      WORKSPACE,
      [...MIXED].reverse(),
    );

    for (const [rowId, proposal] of forwards) {
      expect(digest(backwards.get(rowId)!)).toEqual(digest(proposal));
    }
  });
});

describe('INT-CONNECT-01 SECURITY — a proposal never carries another tenant evidence', () => {
  /**
   * WHY THESE EXIST EVEN THOUGH THE PREDICATES ARE ALREADY TESTED.
   *
   * `resource-identity-resolution.service.spec.ts` ("TENANT BOUNDARY (§34)")
   * already asserts the three `loadEvidence` WHERE clauses. That proves the
   * QUERY. These prove the CONSEQUENCE at the seam that newly consumes it: that
   * a foreign tenant's row cannot surface as a candidate, cannot become the
   * resolved identity, and cannot attach its human decision to a row this
   * workspace can see. A predicate can be right today and a projection still
   * leak tomorrow; these fail if either does.
   */

  it('CASE 3 — a foreign workspace catalog row with an EXACTLY matching name stays invisible', async () => {
    // `cat-foreign-air` is named "Air" too. If the tenant predicate ever widened,
    // the Owner's own row would stop being a single exact match and this test
    // would fail loudly rather than silently changing a verdict.
    const proposal = await proposeOne(row());

    expect(proposal.resource.status).toBe('RESOLVED');
    expect(proposal.resource.resourceCatalogId).toBe('cat-air');
    const seen = proposal.resource.candidates.map((c) => c.resourceCatalogId);
    expect(seen).not.toContain('cat-foreign-air');
    expect(seen).toEqual(['cat-air']);
  });

  it('CASE 3b — no foreign id appears ANYWHERE in a whole mixed batch proposal', async () => {
    // Serialised whole-payload check: a leak through any field — resolved id,
    // candidate list, any future field — fails here even if a future field is
    // added that these assertions do not name individually.
    const proposals = await createService().proposeForRows(WORKSPACE, [
      row({ id: 'r1' }),
      row({ id: 'r2', rawResourceNameText: 'Semen', rawUnitText: 'kg' }),
      row({ id: 'r3', rawResourceNameText: 'Pasir Beton', rawUnitText: 'kg' }),
      row({
        id: 'r4',
        rawResourceNameText: 'Pekerja',
        sourceSection: 'LABOR',
        rawUnitText: 'jam',
      }),
    ]);
    const payload = JSON.stringify([...proposals.values()]);

    expect(payload).not.toContain('cat-foreign-air');
    expect(payload).not.toContain('X.99');
    expect(payload).not.toContain(FOREIGN_WORKSPACE);
  });

  it('CASE 4 — a prior human decision recorded by ANOTHER workspace never attaches', async () => {
    // The foreign mapping names `cat-global-pasir`, a row THIS workspace can
    // legitimately see. So the candidate being visible is not the protection —
    // the mapping query's own strict workspace predicate is. If that ever
    // widened, the foreign reviewer's reason text would ride out on a candidate
    // this workspace is allowed to look at.
    const proposal = await proposeOne(
      row({ rawResourceNameText: 'Pasir Beton', rawUnitText: 'kg' }),
    );

    expect(proposal.resource.resourceCatalogId).toBe('cat-global-pasir');
    for (const candidate of proposal.resource.candidates) {
      expect(candidate.hasPriorHumanDecision).toBe(false);
    }
    const payload = JSON.stringify(proposal);
    expect(payload).not.toContain('RAHASIA TENANT LAIN');
    expect(payload).not.toContain('foreign-reviewer');
  });

  it('CASE 4b — SAME WORKSPACE, DIFFERENT ACCOUNT: the knowledge is reused, the private record is not', async () => {
    /**
     * THE DEFECT THIS TEST EXISTS FOR.
     *
     * Account A resolved a row on A's OWN batch and typed a private note.
     * Account B then opens B's OWN batch, in the SAME workspace, containing a row
     * for the same candidate. Two things must BOTH hold:
     *
     *   REUSE  — SIMPROK may lawfully know a human already chose this row, and
     *            the mapping must still nominate the candidate exactly as before
     *            (REVIEWED_MAPPING_NAME_MATCH is still governed evidence).
     *   PRIVACY— B must never read A's account id, A's timestamp, or A's note.
     *            A batch is user-owned; B cannot open A's batch, and must not
     *            receive its private contents indirectly either.
     *
     * An earlier version of this suite asserted the outward shape was
     * `{ decidedAt, reason }` — which WAS the leak. The projection is now a bare
     * boolean, and this test asserts the serialized payload, not just the type.
     */
    const ACCOUNT_A_SECRET = 'account-a-secret-id';
    const PRIVATE_NOTE = 'CATATAN PRIVAT YANG TIDAK BOLEH KELUAR';
    const DECIDED_AT = new Date('2026-03-04T05:06:07.000Z');

    const accountAMapping: StubRowResourceMapping = {
      id: 'map-account-a',
      workspaceId: WORKSPACE,
      resourceCatalogId: 'cat-air',
      reviewerAccountId: ACCOUNT_A_SECRET,
      decidedAt: DECIDED_AT,
      reason: PRIVATE_NOTE,
      row: {
        rawResourceNameText: 'Air',
        rawResourceCodeText: null,
        resolvedResourceType: 'MATERIAL',
        sourceSection: 'MATERIAL',
      },
    };

    const standIn = createPrisma();
    let mappingsSeenByEngine: StubRowResourceMapping[] = [];
    standIn.basicPriceImportRowResourceMapping.findMany = async ({
      where,
    }: { where?: StubMappingWhere } = {}) => {
      mappingsSeenByEngine = [accountAMapping].filter(
        (m) =>
          !('workspaceId' in where!) || m.workspaceId === where.workspaceId,
      );
      return Promise.resolve(mappingsSeenByEngine);
    };
    const prisma = asPrismaClient(standIn);
    const units = new UnitKernelService(prisma);
    const identity = new ResourceIdentityResolutionService(prisma, units);
    const service = new BasicPriceRowResolutionProposalService(
      prisma,
      units,
      identity,
    );

    // Account B resolving B's own row for the same resource.
    const proposal = (await service.proposeForRows(WORKSPACE, [row()])).get(
      'row-1',
    )!;
    const payload = JSON.stringify(proposal);

    // ---- KNOWLEDGE STAYS ACTIVE ----
    // The engine really did receive A's mapping: nothing was deleted, archived,
    // or withheld from the canonical authority.
    expect(mappingsSeenByEngine).toHaveLength(1);
    expect(mappingsSeenByEngine[0].reason).toBe(PRIVATE_NOTE);
    // And the verdict is unchanged by the projection narrowing.
    expect(proposal.resource.status).toBe('RESOLVED');
    expect(proposal.resource.resourceCatalogId).toBe('cat-air');

    // ---- PRIVACY HOLDS AT THE PROJECTION BOUNDARY ----
    // B is told THAT a human chose it, which is all B's decision needs.
    const chosen = proposal.resource.candidates.find(
      (c) => c.resourceCatalogId === 'cat-air',
    )!;
    expect(chosen.hasPriorHumanDecision).toBe(true);
    expect(Object.keys(chosen)).not.toContain('priorHumanDecision');

    // Asserted on the SERIALIZED payload, so a future field cannot smuggle it.
    expect(payload).not.toContain(ACCOUNT_A_SECRET);
    expect(payload).not.toContain(PRIVATE_NOTE);
    expect(payload).not.toContain('2026-03-04');
    expect(payload).not.toContain('map-account-a');
    expect(payload).not.toContain('reviewerAccountId');
  });

  it('CASE 4c — a candidate with NO prior decision reports false, never a leaked null-shape', async () => {
    const proposal = await proposeOne(
      row({ rawResourceNameText: 'Semen', rawUnitText: 'kg' }),
    );
    expect(proposal.resource.candidates.length).toBeGreaterThan(0);
    for (const candidate of proposal.resource.candidates) {
      expect(candidate.hasPriorHumanDecision).toBe(false);
      expect(typeof candidate.hasPriorHumanDecision).toBe('boolean');
    }
  });

  it('CASE 5 — the admissible set stays workspace-strict for a foreign row too', async () => {
    // Belt and braces over BP-INT-19: even if a foreign row somehow reached the
    // resolved slot, admissibility mirrors resolveRow and would refuse it.
    const service = createService();
    const admissible = await internalsOf(service).admissibleCatalogIds(
      asPrismaClient(createPrisma()),
      WORKSPACE,
      [
        { resourceCatalogId: 'cat-air' },
        { resourceCatalogId: 'cat-foreign-air' },
        { resourceCatalogId: 'cat-global-pasir' },
      ],
    );

    expect(admissible.has('cat-air')).toBe(true);
    expect(admissible.has('cat-foreign-air')).toBe(false);
    expect(admissible.has('cat-global-pasir')).toBe(false);
  });

  /**
   * CASE 6 — THE ADMISSIBILITY CHECK READS THE CALLER'S TRANSACTION.
   *
   * `proposeForRows` takes a `client` so the RESOLVE path can pass its own
   * transaction: `admit-resource` creates a catalog row and resolves the row in
   * ONE transaction, and the seam must see the row that transaction just wrote.
   * The evidence load honoured that from the start; the admissibility check did
   * not — it read the ambient connection, so the authority would propose the
   * freshly admitted resource and this check would answer "not admissible"
   * because, outside the transaction, no such row exists.
   *
   * The consequence was not cosmetic: the resolve path records what the machine
   * offered at the instant a human decided, so the permanent record would say
   * the machine offered nothing on precisely the row where it had offered the
   * right answer.
   *
   * The stand-ins below make the two connections DISAGREE on purpose. Only a
   * client that is actually threaded through can see the transaction's row.
   */
  it('CASE 6 — a resource admitted inside the caller transaction is admissible', async () => {
    const ambient = asPrismaClient(createPrisma());
    const service = new BasicPriceRowResolutionProposalService(
      ambient,
      new UnitKernelService(ambient),
      new ResourceIdentityResolutionService(
        ambient,
        new UnitKernelService(ambient),
      ),
    );

    // The transaction alone can see it — exactly like a row INSERTed and not
    // yet committed.
    const tx = asPrismaClient(
      createPrisma([
        ...CATALOG,
        {
          id: 'cat-admitted-in-tx',
          workspaceId: WORKSPACE,
          code: null,
          name: 'Baru Diakui',
          type: 'MATERIAL',
          baseUnit: 'Kg',
          status: 'ACTIVE',
          specifications: null,
        },
      ]),
    );

    const viaAmbient = await internalsOf(service).admissibleCatalogIds(
      ambient,
      WORKSPACE,
      [{ resourceCatalogId: 'cat-admitted-in-tx' }],
    );
    const viaTransaction = await internalsOf(service).admissibleCatalogIds(
      tx,
      WORKSPACE,
      [{ resourceCatalogId: 'cat-admitted-in-tx' }],
    );

    expect(viaAmbient.has('cat-admitted-in-tx')).toBe(false);
    expect(viaTransaction.has('cat-admitted-in-tx')).toBe(true);
  });
});

/**
 * INT-CONNECT-01 — DATA MINIMIZATION AT THE OUTWARD BOUNDARY.
 *
 * RICH INSIDE, MINIMUM NECESSARY OUTSIDE — proven rather than asserted.
 *
 * Every fixture below is chosen so the REAL authorities build an internal
 * explanation out of things a browser must never receive. The suite then proves
 * two halves of one law in the same breath:
 *
 *   1. the authority STILL KNOWS — nothing was deleted to obtain privacy, which
 *      would have been a downgrade of SIMPROK rather than a repair;
 *   2. the serialized Basic Price proposal carries NONE of it.
 *
 * WHAT EACH SENTINEL ACTUALLY PROVES, because the two halves are not asserted
 * for the same set and saying otherwise would overclaim this suite:
 *
 *   BOTH HALVES — asserted present internally AND absent outwardly:
 *     the two catalog row UUIDs and the model's own name `ResourceCatalog`
 *     (inside `verdict.explanation`), and the reviewer account id and private
 *     note (inside `candidate.priorHumanDecision`).
 *
 *   ABSENCE ONLY — asserted absent from the payload, with NO companion
 *   assertion that the authority's explanation contained it:
 *     `alias-private-999`, and the decision timestamp.
 *
 * The absence-only probes are still worth holding — a projection that started
 * leaking alias provenance would fail here — but they are not evidence of what
 * the authority knows, and no report may cite them as such.
 *
 * These fixtures are deliberately LOCAL. Adding a same-workspace mapping to the
 * suite-wide MAPPINGS would feed candidate discovery in every other test.
 */
describe('INT-CONNECT-01 — the outward proposal carries no internal explanation', () => {
  const SENTINEL_CATALOG_ID = '11111111-2222-3333-4444-555555555555';
  const SENTINEL_CATALOG_ID_B = '66666666-7777-8888-9999-000000000000';
  const SENTINEL_ALIAS_ID = 'alias-private-999';
  const SENTINEL_ACCOUNT = 'account-private-123';
  const SENTINEL_NOTE = 'CATATAN PRIVAT JANGAN KELUAR';

  const SENTINEL_UNIT: StubUnitDefinition = {
    id: 'unit-sentinel-liter',
    code: 'LITER',
    displayName: 'Litre',
    symbol: 'liter',
    dimension: 'VOLUME',
    kind: 'CANONICAL',
    isActive: true,
  };

  /**
   * One alias id is itself a sentinel, used as an ABSENCE probe only: alias ids
   * are internal provenance and must never reach the payload. This suite does
   * not assert that the authority's explanation contained it — see the header.
   */
  const SENTINEL_ALIASES: StubUnitAlias[] = [
    {
      id: SENTINEL_ALIAS_ID,
      normalizedAlias: 'ltr',
      context: null,
      unitDefinition: SENTINEL_UNIT,
    },
    {
      id: 'a-liter-2',
      normalizedAlias: 'liter',
      context: null,
      unitDefinition: SENTINEL_UNIT,
    },
  ];

  /**
   * TWO ROWS, ONE NAME, ONE TYPE — an exact-representation tie, chosen because
   * the tie branch builds one of the kernel's richest explanations: it names
   * every tied row's id, which is what the assertions below actually pin.
   */
  const SENTINEL_CATALOG: StubResourceCatalogRow[] = [
    {
      id: SENTINEL_CATALOG_ID,
      workspaceId: WORKSPACE,
      code: 'S.01',
      name: 'Semen Sentinel',
      type: 'MATERIAL',
      baseUnit: 'Liter',
      status: 'ACTIVE',
      specifications: null,
    },
    {
      id: SENTINEL_CATALOG_ID_B,
      workspaceId: WORKSPACE,
      code: 'S.02',
      name: 'Semen Sentinel',
      type: 'MATERIAL',
      baseUnit: 'liter',
      status: 'ACTIVE',
      specifications: null,
    },
  ];

  /** A decision made by THIS workspace, so nothing about it is filtered by the
   *  tenant predicate. Only the projection may keep its private half out. */
  const SENTINEL_MAPPINGS: StubRowResourceMapping[] = [
    {
      id: 'map-sentinel',
      workspaceId: WORKSPACE,
      resourceCatalogId: SENTINEL_CATALOG_ID,
      reviewerAccountId: SENTINEL_ACCOUNT,
      decidedAt: new Date('2026-02-03T04:05:06.000Z'),
      reason: SENTINEL_NOTE,
      row: {
        rawResourceNameText: 'Semen Sentinel',
        rawResourceCodeText: null,
        resolvedResourceType: 'MATERIAL',
        sourceSection: 'MATERIAL',
      },
    },
  ];

  const sentinelPrisma = (): PrismaStandIn => ({
    unitAlias: {
      findMany: ({ where }: { where: StubUnitAliasWhere }) => {
        const wanted: string[] =
          typeof where.normalizedAlias === 'string'
            ? [where.normalizedAlias]
            : (where.normalizedAlias?.in ?? []);
        return Promise.resolve(
          SENTINEL_ALIASES.filter((a) => wanted.includes(a.normalizedAlias)),
        );
      },
    },
    unitDefinition: {
      findMany: ({ where }: { where?: StubUnitDefinitionWhere }) =>
        Promise.resolve(
          [SENTINEL_UNIT].filter((u) => (where?.id?.in ?? []).includes(u.id)),
        ),
      findFirst: () => Promise.resolve(null),
    },
    unitConversionRule: { findMany: () => Promise.resolve([]) },
    resourceCatalog: {
      findMany: ({ where }: { where?: StubResourceCatalogWhere } = {}) =>
        Promise.resolve(
          SENTINEL_CATALOG.filter((rowValue) => {
            if (Array.isArray(where!.OR)) {
              const ok = where!.OR.some((clause) =>
                Object.entries(clause).every(
                  ([k, v]) => rowValue[k as keyof StubResourceCatalogRow] === v,
                ),
              );
              if (!ok) return false;
            }
            if (where!.id?.in && !where!.id.in.includes(rowValue.id))
              return false;
            if (
              'workspaceId' in where! &&
              rowValue.workspaceId !== where.workspaceId
            )
              return false;
            if ('status' in where! && rowValue.status !== where.status)
              return false;
            return true;
          }),
        ),
    },
    resourceSourceIdentity: { findMany: () => Promise.resolve([]) },
    basicPriceImportRowResourceMapping: {
      findMany: ({ where }: { where?: StubMappingWhere } = {}) =>
        Promise.resolve(
          SENTINEL_MAPPINGS.filter(
            (m) =>
              !('workspaceId' in where!) || m.workspaceId === where.workspaceId,
          ),
        ),
    },
  });

  const sentinelRow: ProposalRow = {
    id: 'row-sentinel',
    sourceSection: 'MATERIAL',
    rawResourceNameText: 'Semen Sentinel',
    rawResourceCodeText: null,
    rawUnitText: 'ltr',
  };

  /** The authority's own verdict for the same row, asked directly. */
  const internalVerdict = async () => {
    const prisma = asPrismaClient(sentinelPrisma());
    const units = new UnitKernelService(prisma);
    const identity = new ResourceIdentityResolutionService(prisma, units);
    const evidence = await identity.loadEvidence(prisma, WORKSPACE);
    return identity.resolve(evidence, {
      rawName: sentinelRow.rawResourceNameText,
      rawCode: sentinelRow.rawResourceCodeText,
      rawUnit: sentinelRow.rawUnitText,
      resourceType: 'MATERIAL',
    });
  };

  const outwardProposal = async () => {
    const prisma = asPrismaClient(sentinelPrisma());
    const units = new UnitKernelService(prisma);
    const identity = new ResourceIdentityResolutionService(prisma, units);
    const service = new BasicPriceRowResolutionProposalService(
      prisma,
      units,
      identity,
    );
    return (await service.proposeForRows(WORKSPACE, [sentinelRow])).get(
      sentinelRow.id,
    )!;
  };

  it('KEEPS the rich internal explanation — privacy is not obtained by forgetting', async () => {
    const verdict = await internalVerdict();

    // The authority still says everything an auditor would need.
    expect(verdict.explanation).toContain(SENTINEL_CATALOG_ID);
    expect(verdict.explanation).toContain(SENTINEL_CATALOG_ID_B);
    expect(verdict.explanation).toContain('ResourceCatalog');
    expect(verdict.explanation.length).toBeGreaterThan(0);

    // And it still HOLDS the human decision in full, reviewer and note included.
    const decided = verdict.candidates.find(
      (c) => c.resourceCatalogId === SENTINEL_CATALOG_ID,
    );
    expect(decided?.priorHumanDecision?.reviewerAccountId).toBe(
      SENTINEL_ACCOUNT,
    );
    expect(decided?.priorHumanDecision?.reason).toBe(SENTINEL_NOTE);
  });

  it('SENDS none of it: no sentinel survives into the serialized proposal', async () => {
    const proposal = await outwardProposal();
    const payload = JSON.stringify(proposal);

    // WHAT THIS LIST DOES AND DOES NOT SAY. Every entry is asserted ABSENT from
    // the payload. Only some have a companion assertion in the test above that
    // the authority held them: SENTINEL_ACCOUNT, SENTINEL_NOTE and
    // 'ResourceCatalog' do, so for those three this is the second half of a
    // complete rich-inside/absent-outside pair. SENTINEL_ALIAS_ID and the
    // timestamp do NOT — they are absence probes, and no report may cite them as
    // evidence of what the authority knows. See the suite header.
    for (const sentinel of [
      SENTINEL_ALIAS_ID,
      SENTINEL_ACCOUNT,
      SENTINEL_NOTE,
      'ResourceCatalog',
      '2026-02-03T04:05:06',
    ]) {
      expect(payload).not.toContain(sentinel);
    }

    /**
     * A CATALOG ID IS NOT A LEAK — WHERE IT SITS DECIDES THAT.
     *
     * Both ids ARE in this payload, and they must be: the candidate list is the
     * reviewer's decision surface, and `resolveRow` demands an exact
     * ResourceCatalog id. What the old defect did was print them inside PROSE,
     * where nothing could tell a reader they were internal. So the law is
     * positional, and it is checked positionally: every id occurrence must be
     * the value of a structured identity field, never loose in a sentence.
     *
     * The frontend's own law completes the pair — `rowMachineNarrative` puts
     * that id in a React key and never in `text`.
     */
    const idFields = ['resourceCatalogId', 'unitDefinitionId'];
    for (const id of [SENTINEL_CATALOG_ID, SENTINEL_CATALOG_ID_B]) {
      const occurrences = payload.split(id).length - 1;
      const structured = idFields.reduce(
        (total, field) =>
          total + (payload.split(`"${field}":"${id}"`).length - 1),
        0,
      );
      expect(occurrences).toBeGreaterThan(0);
      expect(structured).toBe(occurrences);
    }
  });

  it('has no `explanation` property on either leg, under any name', async () => {
    const proposal = await outwardProposal();

    expect(proposal.unit).not.toHaveProperty('explanation');
    expect(proposal.resource).not.toHaveProperty('explanation');
    // Nor renamed into a hiding place.
    for (const alias of [
      'rawExplanation',
      'internalExplanation',
      'debugExplanation',
      'machineExplanation',
    ]) {
      expect(proposal.unit).not.toHaveProperty(alias);
      expect(proposal.resource).not.toHaveProperty(alias);
    }
    // The whole outward shape of each leg, fenced. A future field cannot be
    // added to the browser payload without this test being read and changed.
    expect(Object.keys(proposal.unit).sort()).toEqual([
      'contextScoped',
      'policyVersion',
      'rawUnit',
      'reasonCode',
      'status',
      'trustedContext',
      'unitCode',
      'unitDefinitionId',
      'unitDimension',
      'unitDisplayName',
      'unitKind',
      'unitSymbol',
    ]);
    expect(Object.keys(proposal.resource).sort()).toEqual([
      'admissibleForResolve',
      'authority',
      'candidates',
      'policyVersion',
      'reasonCodes',
      'resourceBaseUnit',
      'resourceCatalogId',
      'resourceCode',
      'resourceName',
      'resourceType',
      'status',
    ]);
  });

  it('still hands the reviewer everything they need to decide', async () => {
    const proposal = await outwardProposal();

    // The refusal is NAMED, the candidates are USABLE, and the safe history
    // signal survives as a bare boolean. Minimum necessary is not minimum.
    expect(proposal.resource.status).toBe('NEEDS_REVIEW');
    expect(proposal.resource.reasonCodes.length).toBeGreaterThan(0);
    expect(proposal.resource.candidates).toHaveLength(2);
    const chosen = proposal.resource.candidates.find(
      (c) => c.resourceCatalogId === SENTINEL_CATALOG_ID,
    )!;
    expect(chosen.name).toBe('Semen Sentinel');
    expect(chosen.code).toBe('S.01');
    expect(chosen.baseUnit).toBe('Liter');
    expect(chosen.hasPriorHumanDecision).toBe(true);
    expect(proposal.identityPairProven).toBe(false);
  });
});
