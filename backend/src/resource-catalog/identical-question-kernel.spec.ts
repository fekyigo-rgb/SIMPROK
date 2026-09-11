/**
 * IQL-01 — the kernel seam an exact-question answer passes through. It is the
 * SAME seam GHX uses (`verifiedIdentityDecision`), with a scope that selects the
 * decidability predicate and the truthful authority label. Everything else —
 * machine first, candidate membership, specification safety — is unchanged.
 */
import {
  IdentityCatalogCandidate,
  ResourceIdentityResolution,
  VerifiedIdentityDecisionFact,
  isHumanDecidable,
  isIdenticalQuestionDecidable,
  isSingleStrongCandidate,
  resolveResourceIdentity,
} from './resource-identity-resolution.kernel';

const row = (
  over: Partial<IdentityCatalogCandidate> & {
    id: string;
    name: string;
    baseUnit: string;
  },
): IdentityCatalogCandidate => ({
  code: null,
  type: 'MATERIAL',
  status: 'ACTIVE',
  ...over,
});

// The real golden shape: "Agregat kasar / M03 / M3 / MATERIAL" nominates exactly
// one row, "Kerikil / Agregat" [M3], by a shared stem — never an exact match.
const KERIKIL = row({
  id: 'cat-kerikil',
  name: 'Kerikil / Agregat',
  baseUnit: 'M3',
});
const AGREGAT_KASAR = {
  rawName: 'Agregat kasar',
  rawCode: 'M03',
  rawUnit: 'M3',
  resourceType: 'MATERIAL',
};

const fact = (
  resourceCatalogId: string,
  scope: VerifiedIdentityDecisionFact['scope'] = 'IDENTICAL_QUESTION',
): VerifiedIdentityDecisionFact => ({
  resourceCatalogId,
  decidedByAccountId: 'acct-second',
  decidedAt: '2026-09-11T09:00:00.000Z',
  generation: 2,
  reason: null,
  scope,
});

const run = (
  candidates: IdentityCatalogCandidate[],
  decision?: VerifiedIdentityDecisionFact,
  reference: typeof AGREGAT_KASAR = AGREGAT_KASAR,
) =>
  resolveResourceIdentity({
    reference,
    catalogCandidates: candidates,
    sourceSightings: [],
    reviewedMappings: [],
    verifiedIdentityDecision: decision,
  });

describe('IQL-01 kernel seam', () => {
  it('the golden question is exactly ONE strong candidate — NEEDS_REVIEW, nothing else wrong', () => {
    const machine = run([KERIKIL]);
    expect(machine.status).toBe('NEEDS_REVIEW');
    expect(machine.reasonCodes).toEqual(['STRONG_CANDIDATE_NEEDS_REVIEW']);
    expect(machine.candidates.map((c) => c.resourceCatalogId)).toEqual([
      'cat-kerikil',
    ]);
    expect(isSingleStrongCandidate(machine)).toBe(true);
    expect(isIdenticalQuestionDecidable(machine)).toBe(true);
    // GHX's own predicate is untouched: a single candidate is not its question.
    expect(isHumanDecidable(machine)).toBe(false);
  });

  it('an APPROVED exact-question answer resolves it, labelled as human-verified reuse', () => {
    const result = run([KERIKIL], fact('cat-kerikil'));
    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('VERIFIED_IDENTICAL_QUESTION_REUSED');
    expect(result.reasonCodes).toEqual(['VERIFIED_IDENTICAL_QUESTION_REUSED']);
    expect(result.resolvedResourceCatalogId).toBe('cat-kerikil');
    expect(result.reasonCodes).not.toContain('EXACT_CANONICAL_MATCH');
  });

  it('the explanation keeps the semantic boundary: human-verified, exact question only, no unit or price truth', () => {
    const { explanation } = run([KERIKIL], fact('cat-kerikil'));
    expect(explanation).toContain('DIVERIFIKASI MANUSIA');
    expect(explanation).toContain('pertanyaan yang persis sama');
    expect(explanation).toContain('bukan dibuktikan mesin');
    expect(explanation).toContain('bukan padanan untuk ejaan lain');
    expect(explanation).toContain('Kebenaran unit dan harga tidak ikut');
    expect(explanation).toContain(
      'Mesin tidak dapat menetapkan identitas sendiri',
    );
  });

  it('the SAME fact under GHX scope changes nothing — the source-fact law is unchanged', () => {
    const machine = run([KERIKIL]);
    const underGhx = run([KERIKIL], fact('cat-kerikil', 'SOURCE_FACT'));
    const absentScope = run([KERIKIL], {
      ...fact('cat-kerikil'),
      scope: undefined,
    });
    expect(JSON.stringify(underGhx)).toBe(JSON.stringify(machine));
    expect(JSON.stringify(absentScope)).toBe(JSON.stringify(machine));
  });

  it('machine RESOLVED always wins: an exact match is never replaced by memory', () => {
    const exact = row({
      id: 'cat-exact',
      name: 'Agregat kasar',
      baseUnit: 'M3',
    });
    const withMemory = run([exact, KERIKIL], fact('cat-kerikil'));
    expect(withMemory.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(withMemory.resolvedResourceCatalogId).toBe('cat-exact');
  });

  it('an answer outside the machine’s own candidates is refused — memory never manufactures identity', () => {
    const result = run([KERIKIL], fact('cat-not-a-candidate'));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('an INACTIVE target is not a candidate, so it can never be reused', () => {
    const inactive = row({
      id: 'cat-kerikil',
      name: 'Kerikil / Agregat',
      baseUnit: 'M3',
      status: 'INACTIVE',
    });
    const result = run([inactive], fact('cat-kerikil'));
    expect(result.status).not.toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('a single candidate whose specification is unproved is never decidable', () => {
    const withSpec = row({
      id: 'cat-kerikil',
      name: 'Kerikil / Agregat',
      baseUnit: 'M3',
      specifications: { size: '2/3' },
    });
    const machine = run([withSpec]);
    expect(machine.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(isSingleStrongCandidate(machine)).toBe(false);
    expect(run([withSpec], fact('cat-kerikil')).status).not.toBe('RESOLVED');
  });

  it('a hard class boundary cannot be crossed by memory', () => {
    const labour = row({
      id: 'cat-agregat-labor',
      name: 'Agregat kasar',
      baseUnit: 'OH',
      type: 'LABOR',
    });
    const result = run([labour], fact('cat-agregat-labor'));
    expect(result.reasonCodes).toContain('RESOURCE_TYPE_MISMATCH');
    expect(result.status).toBe('UNRESOLVED');
  });

  it.each<[string, Partial<ResourceIdentityResolution>]>([
    ['two candidates', { reasonCodes: ['MULTIPLE_CANDIDATES_NEEDS_REVIEW'] }],
    [
      'an extra reason code',
      {
        reasonCodes: [
          'STRONG_CANDIDATE_NEEDS_REVIEW',
          'REVIEWED_MAPPING_CONFLICT',
        ],
      },
    ],
    ['a resolved verdict', { status: 'RESOLVED' }],
    ['an unresolved verdict', { status: 'UNRESOLVED' }],
  ])('isSingleStrongCandidate is exact — refused with %s', (_label, change) => {
    const golden = run([KERIKIL]);
    expect(isSingleStrongCandidate({ ...golden, ...change })).toBe(false);
  });
});
