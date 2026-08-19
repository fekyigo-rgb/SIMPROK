/**
 * GHX-01 — the ONE seam where a governed human decision becomes an identity.
 *
 * Everything here is about what the seam REFUSES to do. A human decision that
 * could override machine truth, invent a candidate, bypass specification safety
 * or prove a unit would be a second resolver wearing the kernel's clothes.
 */
import {
  IdentityCatalogCandidate,
  VerifiedIdentityDecisionFact,
  resolveResourceIdentity,
} from './resource-identity-resolution.kernel';

const row = (
  over: Partial<IdentityCatalogCandidate> & { id: string; name: string; baseUnit: string },
): IdentityCatalogCandidate => ({
  code: null,
  type: 'MATERIAL',
  status: 'ACTIVE',
  ...over,
});

const MORTAR_M3 = row({ id: 'cat-m3', name: 'Mortar', baseUnit: 'm3' });
const MORTAR_KG = row({ id: 'cat-kg', name: 'Mortar', baseUnit: 'kg' });
const PEKERJA = row({ id: 'cat-pekerja', name: 'Pekerja', baseUnit: 'OH', type: 'LABOR' });

const DECISION = (resourceCatalogId: string): VerifiedIdentityDecisionFact => ({
  resourceCatalogId,
  decidedByAccountId: 'acct-andi',
  decidedAt: '2026-08-17T09:00:00.000Z',
  generation: 1,
  reason: 'Sumber B4 memaksudkan representasi m3.',
});

const run = (
  candidates: IdentityCatalogCandidate[],
  decision?: VerifiedIdentityDecisionFact,
  reference = { rawName: 'Mortar', rawCode: null, rawUnit: null, resourceType: 'MATERIAL' },
) =>
  resolveResourceIdentity({
    reference,
    catalogCandidates: candidates,
    sourceSightings: [],
    reviewedMappings: [],
    verifiedIdentityDecision: decision,
  });

describe('GHX-01 human decision seam', () => {
  // ---------- MACHINE FIRST ----------
  it('a machine-proven identity is NEVER overridden by human memory', () => {
    // One exact row: the machine settles it. Even a human decision naming the
    // OTHER row must not be reached, let alone applied.
    const machineOnly = run([PEKERJA], undefined, {
      rawName: 'Pekerja', rawCode: null, rawUnit: null, resourceType: 'LABOR',
    });
    const withDecision = run([PEKERJA], DECISION('cat-somewhere-else'), {
      rawName: 'Pekerja', rawCode: null, rawUnit: null, resourceType: 'LABOR',
    });

    expect(machineOnly.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(withDecision.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(withDecision.resolvedResourceCatalogId).toBe(PEKERJA.id);
    expect(JSON.stringify(withDecision)).toBe(JSON.stringify(machineOnly));
  });

  it('absent memory behaves exactly as before — every pre-GHX caller is unchanged', () => {
    const before = run([MORTAR_M3, MORTAR_KG]);

    expect(before.status).toBe('NEEDS_REVIEW');
    expect(before.authority).toBe('HUMAN_REVIEW_REQUIRED');
  });

  // ---------- THE LEGITIMATE PATH ----------
  it('settles a genuine tie the machine could not, with HUMAN authority', () => {
    const result = run([MORTAR_M3, MORTAR_KG], DECISION(MORTAR_M3.id));

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('VERIFIED_MAPPING_REUSED');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
    expect(result.reasonCodes).toEqual(['VERIFIED_MAPPING_REUSED']);
    // Never dressed up as a machine proof.
    expect(result.reasonCodes).not.toContain('EXACT_CANONICAL_MATCH');
    expect(result.reasonCodes).not.toContain('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
  });

  it('the explanation says HUMAN VERIFIED, names the actor, and keeps the machine story', () => {
    const result = run([MORTAR_M3, MORTAR_KG], DECISION(MORTAR_M3.id));

    expect(result.explanation).toContain('DIVERIFIKASI MANUSIA');
    expect(result.explanation).toContain('bukan dibuktikan mesin');
    expect(result.explanation).toContain('acct-andi');
    expect(result.explanation).toContain('generasi 1');
    // the machine's own refusal survives inside it — why a human was needed
    expect(result.explanation).toContain('Mesin tidak dapat menetapkan identitas sendiri');
    expect(result.explanation).toContain('2 entri ResourceCatalog');
  });

  it('states plainly that unit and price truth are NOT settled by it', () => {
    const result = run([MORTAR_M3, MORTAR_KG], DECISION(MORTAR_M3.id));

    expect(result.explanation).toContain('Kebenaran unit dan harga tidak ikut');
  });

  // ---------- CANDIDATE-BOUND ----------
  it('CANNOT assert a catalog row the machine never nominated', () => {
    // The arbitrary-id attack. An authorized actor is still only choosing
    // between alternatives; they cannot manufacture identity authority.
    const result = run([MORTAR_M3, MORTAR_KG], DECISION('cat-not-a-candidate'));

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  it('CANNOT resolve when the machine found nothing at all', () => {
    const result = run([PEKERJA], DECISION(PEKERJA.id));

    // RESOURCE_NOT_FOUND has no candidates, so there is nothing to choose between.
    expect(result.reasonCodes).toContain('RESOURCE_NOT_FOUND');
    expect(result.status).toBe('UNRESOLVED');
  });

  // ---------- SPECIFICATION SAFETY IS RE-APPLIED ----------
  it('CANNOT bypass an unproved specification fact', () => {
    // The human settled WHICH resource. They did not settle whether the source
    // meant a diameter it never stated.
    const spec = row({
      id: 'cat-spec', name: 'Mortar', baseUnit: 'm3',
      specifications: { diameter: 16 },
    });
    const result = run([spec, MORTAR_KG], DECISION(spec.id));

    expect(result.status).not.toBe('RESOLVED');
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  it('CANNOT resurrect a row a specification CONFLICT already ruled out', () => {
    const eight = row({ id: 'cat-8', name: 'Besi angker diameter 10', baseUnit: 'm3' });
    const result = run([eight], DECISION(eight.id), {
      rawName: 'Besi angker diameter 8', rawCode: null, rawUnit: null, resourceType: 'MATERIAL',
    });

    expect(result.reasonCodes).toContain('SPECIFICATION_CONFLICT');
    expect(result.status).toBe('UNRESOLVED');
  });

  it('CANNOT cross the resource-type boundary', () => {
    const result = run([PEKERJA], DECISION(PEKERJA.id), {
      rawName: 'Pekerja', rawCode: null, rawUnit: null, resourceType: 'MATERIAL',
    });

    expect(result.reasonCodes).toContain('RESOURCE_TYPE_MISMATCH');
    expect(result.status).toBe('UNRESOLVED');
  });

  it('CANNOT select an inactive row — it is never a candidate', () => {
    const retired = row({ id: 'cat-retired', name: 'Mortar', baseUnit: 'm3', status: 'INACTIVE' });
    const result = run([retired, MORTAR_KG], DECISION(retired.id));

    expect(result.resolvedResourceCatalogId).not.toBe(retired.id);
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });

  // ---------- DETERMINISM ----------
  it('is deterministic — same evidence, same verdict, whatever the row order', () => {
    const forwards = run([MORTAR_M3, MORTAR_KG], DECISION(MORTAR_M3.id));
    const backwards = run([MORTAR_KG, MORTAR_M3], DECISION(MORTAR_M3.id));

    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });
});
