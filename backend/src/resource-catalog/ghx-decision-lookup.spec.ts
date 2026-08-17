/**
 * GHX-01 — the ONE consumption seam, attacked.
 *
 * The kernel proves what a decision may DO. This file proves when it is even
 * CONSULTED: never for a machine-proven identity, never for a refusal a human
 * may not answer, never across a policy change, never for another workspace or
 * source fact, never when the question itself has changed — and never with a
 * query per row.
 */
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';
import { candidateContextDigest } from './ghx-candidate-context';

const WS = 'ws-1';
const SUBJECT = 'ahspres-mortar-b4';
const POLICY = 'E1A_CONTEXTUAL_EXACT_REGION_V2';

const MORTAR_M3 = { id: 'cat-m3', code: null, name: 'Mortar', type: 'MATERIAL', baseUnit: 'm3', status: 'ACTIVE', specifications: null };
const MORTAR_KG = { id: 'cat-kg', code: null, name: 'Mortar', type: 'MATERIAL', baseUnit: 'kg', status: 'ACTIVE', specifications: null };
const PEKERJA = { id: 'cat-pekerja', code: null, name: 'Pekerja', type: 'LABOR', baseUnit: 'OH', status: 'ACTIVE', specifications: null };

const digestOf = (rows: Array<typeof MORTAR_M3>) =>
  candidateContextDigest(
    rows.map((c) => ({
      resourceCatalogId: c.id, name: c.name, type: c.type, baseUnit: c.baseUnit, specifications: c.specifications,
    })),
  );

const TIE_DIGEST = digestOf([MORTAR_KG, MORTAR_M3]);

const decision = (over: Record<string, unknown> = {}) => ({
  selectedResourceCatalogId: MORTAR_M3.id,
  candidateContextDigest: TIE_DIGEST,
  decidedByAccountId: 'acct-andi',
  decidedAt: new Date('2026-08-17T09:00:00.000Z'),
  generation: 1,
  reason: 'Sumber B4 memaksudkan representasi m3.',
  resolutionPolicyVersion: POLICY,
  ...over,
});

describe('GHX-01 consumption seam', () => {
  let units: { resolveCanonicalUnitIdentities: jest.Mock };
  let service: ResourceIdentityResolutionService;

  const evidenceOf = (
    catalogCandidates: any[],
    latest?: Record<string, unknown>,
    subject: Record<string, unknown> | null = { workspaceId: WS, ahspResourceId: SUBJECT, resolutionPolicyVersion: POLICY },
  ) => ({
    catalogCandidates,
    sourceSightings: [],
    reviewedMappings: [],
    ...(subject ? { ghxSubject: subject } : {}),
    ghxLatestDecisions: new Map(latest ? [[SUBJECT, latest]] : []),
  });

  const mortarRef = (rawUnit: string | null = null) => ({
    rawName: 'Mortar', rawCode: null, rawUnit, resourceType: 'MATERIAL',
  });

  beforeEach(() => {
    units = { resolveCanonicalUnitIdentities: jest.fn().mockResolvedValue([]) };
    service = new ResourceIdentityResolutionService({} as any, units as any);
  });

  // ---------- THE LEGITIMATE PATH ----------
  it('settles a genuine tie with HUMAN authority when the decision still applies', async () => {
    const result = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG], decision()) as any, mortarRef());

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('VERIFIED_MAPPING_REUSED');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
    expect(result.explanation).toContain('DIVERIFIKASI MANUSIA');
    expect(result.explanation).toContain('acct-andi');
  });

  // ---------- MACHINE FIRST ----------
  it('a machine-proven identity is never reconsidered', async () => {
    const result = await service.resolve(
      { ...evidenceOf([PEKERJA], decision({ selectedResourceCatalogId: 'cat-anything' })), ghxSubject: { workspaceId: WS, ahspResourceId: SUBJECT, resolutionPolicyVersion: POLICY } } as any,
      { rawName: 'Pekerja', rawCode: null, rawUnit: null, resourceType: 'LABOR' },
    );

    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe(PEKERJA.id);
  });

  it('RM-03D2 unit-context proof BEATS a conflicting human decision', async () => {
    // Source states kg → machine proves the kg representation. Memory naming m3
    // must not win: current evidence outranks historical memory, always.
    units.resolveCanonicalUnitIdentities.mockResolvedValue([
      { rawUnit: 'kg', status: 'RESOLVED', unitDefinition: { id: 'u-kg', code: 'KG' }, reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: ['a-kg'], contextScoped: false, resolvedContext: null, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
      { rawUnit: 'm3', status: 'RESOLVED', unitDefinition: { id: 'u-m3', code: 'M3' }, reasonCode: 'EXACT_UNIT_IDENTITY', matchedAliasIds: ['a-m3'], contextScoped: false, resolvedContext: null, policyVersion: 'KAMUS_UNIT_KERNEL_01A_V1' },
    ]);

    const result = await service.resolve(
      evidenceOf([MORTAR_M3, MORTAR_KG], decision({ selectedResourceCatalogId: MORTAR_M3.id })) as any,
      mortarRef('kg'),
    );

    expect(result.authority).toBe('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_KG.id);
  });

  it('a refusal a human may not answer never consults memory', async () => {
    const result = await service.resolve(evidenceOf([PEKERJA], decision()) as any, mortarRef());

    expect(result.reasonCodes).toContain('RESOURCE_NOT_FOUND');
    expect(result.status).toBe('UNRESOLVED');
  });

  it('a caller with no subject consults nothing', async () => {
    const result = await service.resolve(
      evidenceOf([MORTAR_M3, MORTAR_KG], decision(), null) as any,
      mortarRef(),
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  // ---------- POLICY APPLICABILITY (seam 3A) ----------
  it('a decision recorded under ANOTHER policy is inapplicable', async () => {
    const result = await service.resolve(
      evidenceOf([MORTAR_M3, MORTAR_KG], decision({ resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V3' })) as any,
      mortarRef(),
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  it('an older generation NEVER resurrects behind a newer foreign-policy decision', async () => {
    // gen1 V2 (would match) is hidden behind gen2 V3. Only the LATEST generation
    // is ever consulted, so the answer is "memory does not apply", never
    // "reach past it and use gen1".
    const result = await service.resolve(
      evidenceOf([MORTAR_M3, MORTAR_KG], decision({ generation: 2, resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V3' })) as any,
      mortarRef(),
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.explanation).not.toContain('DIVERIFIKASI MANUSIA');
  });

  // ---------- APPLICABILITY / DRIFT ----------
  it.each([
    ['candidate ADDED', [MORTAR_M3, MORTAR_KG, { ...MORTAR_M3, id: 'cat-doos', baseUnit: 'Doos' }]],
    ['candidate SWAPPED at equal count', [MORTAR_M3, { ...MORTAR_KG, id: 'cat-other', baseUnit: 'Doos' }]],
    ['material name change', [{ ...MORTAR_M3, name: 'Mortar Instan' }, MORTAR_KG]],
    ['material specification change', [{ ...MORTAR_M3, specifications: { diameter: 16 } }, MORTAR_KG]],
  ])('drift — %s makes the decision inapplicable', async (_label, rows) => {
    const result = await service.resolve(evidenceOf(rows as any, decision()) as any, mortarRef());

    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  it('a decision naming a row outside the current candidates is refused', async () => {
    const result = await service.resolve(
      evidenceOf([MORTAR_M3, MORTAR_KG], decision({ selectedResourceCatalogId: 'cat-elsewhere' })) as any,
      mortarRef(),
    );

    expect(result.status).toBe('NEEDS_REVIEW');
  });

  // ---------- SCOPE: same source reuses, different source cannot borrow ----------
  it('the SAME source fact in another project reuses the decision', async () => {
    // Same workspace, same ahspResourceId, different project — the map is keyed
    // on the subject alone, so a second project asks no new human question.
    const first = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG], decision()) as any, mortarRef());
    const second = await service.resolve(evidenceOf([MORTAR_M3, MORTAR_KG], decision()) as any, mortarRef());

    expect(first.authority).toBe('VERIFIED_MAPPING_REUSED');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('a DIFFERENT source fact with identical spelling cannot borrow it', async () => {
    const result = await service.resolve(
      {
        ...evidenceOf([MORTAR_M3, MORTAR_KG], decision()),
        ghxSubject: { workspaceId: WS, ahspResourceId: 'ahspres-different', resolutionPolicyVersion: POLICY },
      } as any,
      mortarRef(),
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  it('another WORKSPACE cannot borrow it, even on the same global source fact', async () => {
    // The preload is workspace-scoped at the query, so workspace Z simply has no
    // entry for this subject. Tenant isolation is structural, not a filter here.
    const result = await service.resolve(
      {
        catalogCandidates: [MORTAR_M3, MORTAR_KG],
        sourceSightings: [],
        reviewedMappings: [],
        ghxSubject: { workspaceId: 'ws-Z', ahspResourceId: SUBJECT, resolutionPolicyVersion: POLICY },
        ghxLatestDecisions: new Map(),
      } as any,
      mortarRef(),
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });
});

// ---------- NO N+1 (seam 3C) ----------
describe('GHX-01 preload — one bounded query per version', () => {
  it('loads the newest decision for every subject in ONE query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client: any = {
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([]) },
      resourceSourceIdentity: { findMany: jest.fn().mockResolvedValue([]) },
      basicPriceImportRowResourceMapping: { findMany: jest.fn().mockResolvedValue([]) },
      ahspResourceIdentityDecision: { findMany },
    };
    const service = new ResourceIdentityResolutionService(client, {} as any);

    // A 50-row version: one query, not fifty.
    const subjects = Array.from({ length: 50 }, (_, i) => `ahspres-${i}`);
    await service.loadEvidence(client, WS, subjects);

    expect(findMany).toHaveBeenCalledTimes(1);
    const [arg] = findMany.mock.calls[0];
    expect(arg.where).toEqual({ workspaceId: WS, ahspResourceId: { in: subjects } });
    // latest-per-subject, never full history
    expect(arg.distinct).toEqual(['ahspResourceId']);
    expect(arg.orderBy).toEqual([{ ahspResourceId: 'asc' }, { generation: 'desc' }]);
  });

  it('adds NO query at all when no subjects are supplied', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const client: any = {
      resourceCatalog: { findMany: jest.fn().mockResolvedValue([]) },
      resourceSourceIdentity: { findMany: jest.fn().mockResolvedValue([]) },
      basicPriceImportRowResourceMapping: { findMany: jest.fn().mockResolvedValue([]) },
      ahspResourceIdentityDecision: { findMany },
    };
    const service = new ResourceIdentityResolutionService(client, {} as any);

    // Basic Price import-row resolution takes this path — it has no AHSP source
    // fact, so it must pay nothing for GHX.
    await service.loadEvidence(client, WS);

    expect(findMany).not.toHaveBeenCalled();
  });
});
