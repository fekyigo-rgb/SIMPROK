/**
 * SIMPROK — Resource Identity Resolution Kernel — test matrix (RM-03D1).
 *
 * The two properties under test are opposites, and both must hold at once:
 *
 *   RECALL   — a candidate that genuinely exists is always found, whatever the
 *              spelling. "Not found" must become very hard to say.
 *   PRECISION— nothing but an exact canonical match or a human's own recorded
 *              decision may ever assert an identity. "Resolved" must stay very
 *              hard to say.
 *
 * The fixtures use the shapes the Owner's real evidence actually produced
 * (a truncated spelling, a transposed one, a shared source code, two plausible
 * cements), because those are the shapes that broke the old exact-name-only
 * path. No fixture is special-cased into the kernel.
 */

import {
  resolveResourceIdentity,
  isExactRepresentationTie,
  ResourceIdentityResolutionInput,
  IdentityCatalogCandidate,
  SourceSightingEvidence,
  ReviewedMappingEvidence,
  CanonicalUnitIdentityFact,
} from './resource-identity-resolution.kernel';

const CATALOG_PEKERJA: IdentityCatalogCandidate = {
  id: 'cat-pekerja',
  code: 'L.01',
  name: 'Pekerja',
  type: 'LABOR',
  baseUnit: 'Org/Hari',
  status: 'ACTIVE',
};

const CATALOG_SEMEN_PORTLAN: IdentityCatalogCandidate = {
  id: 'cat-semen-portlan',
  code: null,
  name: 'Semen Portlan',
  type: 'MATERIAL',
  baseUnit: 'Kg',
  status: 'ACTIVE',
};

const CATALOG_SEMEN_TONASA: IdentityCatalogCandidate = {
  id: 'cat-semen-tonasa',
  code: null,
  name: 'Semen Portland / Tonasa',
  type: 'MATERIAL',
  baseUnit: 'Zak',
  status: 'ACTIVE',
};

const CATALOG_KAWAT_BENRAD: IdentityCatalogCandidate = {
  id: 'cat-kawat-benrad',
  code: null,
  name: 'Kawat benrad',
  type: 'MATERIAL',
  baseUnit: 'Kg',
  status: 'ACTIVE',
};

const CATALOG_BAJA_TULANGAN: IdentityCatalogCandidate = {
  id: 'cat-baja-tulangan',
  code: null,
  name: 'Baja tulangan',
  type: 'MATERIAL',
  baseUnit: 'Kg',
  status: 'ACTIVE',
};

const CATALOG_TANAH_BIASA: IdentityCatalogCandidate = {
  id: 'cat-tanah-biasa',
  code: null,
  name: 'Tanah Biasa',
  type: 'MATERIAL',
  baseUnit: 'M³',
  status: 'ACTIVE',
};

const ALL_CATALOG = [
  CATALOG_PEKERJA,
  CATALOG_SEMEN_PORTLAN,
  CATALOG_SEMEN_TONASA,
  CATALOG_KAWAT_BENRAD,
  CATALOG_BAJA_TULANGAN,
  CATALOG_TANAH_BIASA,
];

const sighting = (
  over: Partial<SourceSightingEvidence> & { resourceCatalogId: string },
): SourceSightingEvidence => ({
  rawName: '',
  rawCode: null,
  rawUnit: null,
  sourceSection: 'MATERIAL',
  sourceSha256: 'A'.repeat(64),
  sheetName: 'HARGA SATUAN UPAH DAN BAHAN',
  sourceRowNumber: 1,
  ...over,
});

const mapping = (
  over: Partial<ReviewedMappingEvidence> & { resourceCatalogId: string },
): ReviewedMappingEvidence => ({
  // Distinct per catalog row by default; the determinism cases below name it
  // explicitly, because that is exactly what they are pinning.
  mappingId: `map-${over.resourceCatalogId}`,
  rawName: '',
  rawCode: null,
  resourceType: 'MATERIAL',
  reviewerAccountId: 'acct-owner',
  decidedAt: '2026-08-07T00:00:00.000Z',
  reason: null,
  ...over,
});

const run = (
  over: Partial<ResourceIdentityResolutionInput> & {
    reference: ResourceIdentityResolutionInput['reference'];
  },
) =>
  resolveResourceIdentity({
    catalogCandidates: ALL_CATALOG,
    sourceSightings: [],
    reviewedMappings: [],
    ...over,
  });

describe('resolveResourceIdentity — authority hierarchy', () => {
  // ---------- A. EXACT MATCH ----------
  it('A. an exact canonical match with one row auto-resolves, no human asked', () => {
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: 'L.01', rawUnit: 'OH', resourceType: 'LABOR' },
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe(CATALOG_PEKERJA.id);
    expect(result.reasonCodes).toEqual(['EXACT_CANONICAL_MATCH']);
  });

  it('A2. case and whitespace never break an exact match', () => {
    const result = run({
      reference: { rawName: '  pekerja  ', rawCode: null, rawUnit: null, resourceType: 'labor' },
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBe(CATALOG_PEKERJA.id);
  });

  // ---------- REVIEWED MAPPING: EVIDENCE, NEVER AUTHORITY ----------
  //
  // BasicPriceImportRowResourceMapping binds one decision to one Basic Price
  // import row. What the human settled is "THIS row means that catalog entry".
  // Nobody ever asked them whether every AHSP line spelled the same way means
  // it too, so nothing here may answer on their behalf.

  it('a row-scoped human decision surfaces as evidence and never becomes the verdict', () => {
    const result = run({
      reference: { rawName: 'BjTP atau BjTS', rawCode: 'M.60.a', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      reviewedMappings: [
        mapping({ resourceCatalogId: CATALOG_BAJA_TULANGAN.id, rawName: 'BjTP atau BjTS', rawCode: 'M.60.a' }),
      ],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
    // The human's work is NOT thrown away — it surfaces the right row first.
    expect(result.candidates.map((c) => c.resourceCatalogId)).toContain(
      CATALOG_BAJA_TULANGAN.id,
    );
    expect(result.candidates[0].evidence).toContain('REVIEWED_MAPPING_NAME_MATCH');
    expect(result.candidates[0].priorHumanDecision).not.toBeNull();
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
  });

  it('same raw name plus same type is NOT enough to inherit another context decision', () => {
    // A supplier price list row spelled "Pasir" was mapped by a human. An AHSP
    // line also spelled "Pasir" is a different fact from a different source.
    const catalogPasirBeton: IdentityCatalogCandidate = {
      id: 'cat-pasir-beton',
      code: null,
      name: 'Pasir Beton',
      type: 'MATERIAL',
      baseUnit: 'M³',
      status: 'ACTIVE',
    };
    const result = run({
      reference: { rawName: 'Pasir', rawCode: null, rawUnit: 'm3', resourceType: 'MATERIAL' },
      catalogCandidates: [catalogPasirBeton],
      reviewedMappings: [
        mapping({ resourceCatalogId: catalogPasirBeton.id, rawName: 'Pasir' }),
      ],
    });

    expect(result.status).not.toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('VERIFIED_MAPPING_REUSED is never emitted, because no model binds a decision to an AHSP fact', () => {
    // Exhaustive over every fixture combination this spec can build: the
    // authority exists in the contract but has no production path today, and
    // claiming it would assert something nobody granted.
    const permutations = [
      run({
        reference: { rawName: 'Kawat bendrat', rawCode: 'M.72', rawUnit: 'Kg', resourceType: 'MATERIAL' },
        reviewedMappings: [
          mapping({ resourceCatalogId: CATALOG_KAWAT_BENRAD.id, rawName: 'Kawat bendrat', rawCode: 'M.72' }),
        ],
      }),
      run({
        reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
        reviewedMappings: [
          mapping({ resourceCatalogId: CATALOG_BAJA_TULANGAN.id, rawName: 'Baja tulangan' }),
        ],
      }),
      run({
        reference: { rawName: 'Portland Cement', rawCode: 'M.23', rawUnit: 'Kg', resourceType: 'MATERIAL' },
        reviewedMappings: [
          mapping({ resourceCatalogId: CATALOG_SEMEN_PORTLAN.id, rawName: 'Portland Cement', rawCode: 'M.23' }),
        ],
      }),
    ];

    for (const result of permutations) {
      expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
      expect(result.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
    }
  });

  it('an exact canonical match still resolves even when a row-scoped decision exists', () => {
    // The mapping must neither grant nor withdraw authority — exactness alone
    // decides, exactly as it did before.
    const result = run({
      reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      reviewedMappings: [
        mapping({ resourceCatalogId: CATALOG_SEMEN_PORTLAN.id, rawName: 'Baja tulangan' }),
      ],
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe(CATALOG_BAJA_TULANGAN.id);
  });

  it('J. a recorded decision about a DIFFERENT raw name is never stretched to cover this one', () => {
    const result = run({
      reference: { rawName: 'Kawat bendrat', rawCode: 'M.72', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      // The human settled "Kawat las", not "Kawat bendrat".
      reviewedMappings: [
        mapping({ resourceCatalogId: CATALOG_KAWAT_BENRAD.id, rawName: 'Kawat las', rawCode: 'M.99' }),
      ],
    });

    expect(result.status).not.toBe('RESOLVED');
    expect(result.reasonCodes).not.toContain('VERIFIED_MAPPING_REUSED');
  });

  it('two recorded decisions that disagree are surfaced, never silently ranked', () => {
    const result = run({
      reference: { rawName: 'Semen PC', rawCode: 'M.23', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      reviewedMappings: [
        mapping({ resourceCatalogId: CATALOG_SEMEN_PORTLAN.id, rawName: 'Semen PC' }),
        mapping({ resourceCatalogId: CATALOG_SEMEN_TONASA.id, rawName: 'Semen PC' }),
      ],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('REVIEWED_MAPPING_CONFLICT');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  // ---------- C / D. EVIDENCE DISCOVERY, NEVER AUTHORITY ----------
  it('C. a shared source code finds the candidate but never asserts it', () => {
    const result = run({
      reference: { rawName: 'BjTP atau BjTS', rawCode: 'M.60.a', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      sourceSightings: [
        sighting({ resourceCatalogId: CATALOG_BAJA_TULANGAN.id, rawName: 'Baja tulangan', rawCode: 'M.60.a ' }),
      ],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).toBe('EVIDENCE_CANDIDATE');
    expect(result.reasonCodes).toContain('STRONG_CANDIDATE_NEEDS_REVIEW');
    expect(result.candidates.map((c) => c.resourceCatalogId)).toContain(CATALOG_BAJA_TULANGAN.id);
    expect(result.candidates[0].evidence).toContain('SOURCE_CODE_MATCH');
    // The whole point: this is emphatically NOT "not found".
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('D. a transposed spelling is still found, through the source code', () => {
    const result = run({
      reference: { rawName: 'Kawat bendrat', rawCode: 'M.72', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      sourceSightings: [
        sighting({ resourceCatalogId: CATALOG_KAWAT_BENRAD.id, rawName: 'Kawat benrad', rawCode: 'M.72' }),
      ],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.candidates.map((c) => c.name)).toContain('Kawat benrad');
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
  });

  it('D2. a truncated spelling is found on name evidence alone, with no code at all', () => {
    const result = run({
      reference: { rawName: 'Portland Cement', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    const names = result.candidates.map((c) => c.name);
    expect(names).toContain('Semen Portlan');
    expect(result.candidates.every((c) => c.evidence.includes('NAME_TOKEN_STEM_SHARED'))).toBe(true);
  });

  it('a longer source phrase containing a catalog name is found by token containment', () => {
    const result = run({
      reference: { rawName: 'Tanah Biasa / liat berpasir', rawCode: null, rawUnit: 'm3', resourceType: 'MATERIAL' },
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.candidates.map((c) => c.name)).toContain('Tanah Biasa');
    expect(
      result.candidates.find((c) => c.name === 'Tanah Biasa')!.evidence,
    ).toContain('NAME_TOKEN_CONTAINMENT');
  });

  // ---------- E. MULTIPLE PLAUSIBLE ----------
  it('E. two plausible cements are both shown and neither is chosen', () => {
    const result = run({
      reference: { rawName: 'Portland Cement', rawCode: 'M.23', rawUnit: 'Kg', resourceType: 'MATERIAL' },
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
    const names = result.candidates.map((c) => c.name).sort();
    expect(names).toEqual(['Semen Portlan', 'Semen Portland / Tonasa']);
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('E2. candidates are never ranked by unit convenience, price, or id order', () => {
    const result = run({
      reference: { rawName: 'Portland Cement', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
    });
    // Both survive; the Kg one is not quietly preferred over the Zak one.
    expect(result.candidates).toHaveLength(2);
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  // ---------- F. WRONG TYPE ----------
  it('F. an exact name of the wrong class is a type mismatch, not a match', () => {
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [CATALOG_PEKERJA],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('RESOURCE_TYPE_MISMATCH');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('F2. a source code shared across classes never crosses the class boundary', () => {
    const result = run({
      reference: { rawName: 'Operator', rawCode: 'M.72', rawUnit: 'OH', resourceType: 'LABOR' },
      // Same code, but the sighting is a MATERIAL sighting.
      sourceSightings: [
        sighting({ resourceCatalogId: CATALOG_KAWAT_BENRAD.id, rawName: 'Kawat benrad', rawCode: 'M.72' }),
      ],
    });

    expect(result.candidates.map((c) => c.resourceCatalogId)).not.toContain(CATALOG_KAWAT_BENRAD.id);
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('RESOURCE_NOT_FOUND');
  });

  // ---------- G / O. SPECIFICATION ----------
  it('G/O. an exact name whose stated specification contradicts never auto-resolves', () => {
    const angker8: IdentityCatalogCandidate = {
      id: 'cat-angker-10',
      code: null,
      name: 'Besi angker diameter 10',
      type: 'MATERIAL',
      baseUnit: 'Kg',
      status: 'ACTIVE',
    };
    const result = run({
      reference: { rawName: 'Besi angker diameter 8', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [angker8],
    });

    expect(result.status).not.toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('G2. a candidate that states a designation the source never did is flagged unproven, not asserted', () => {
    const bjts: IdentityCatalogCandidate = {
      id: 'cat-bjts-420',
      code: null,
      name: 'BjTS 420B Ø13 tulangan',
      type: 'MATERIAL',
      baseUnit: 'Kg',
      status: 'ACTIVE',
    };
    const result = run({
      reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [bjts],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(result.candidates[0].specificationUnproved).toBe(true);
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('G3. a source that states no designation is never given an invented requirement', () => {
    // Exact match, neither side carries a designation → still auto-resolves.
    const result = run({
      reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
  });

  // ---------- structured ResourceCatalog.specifications ----------
  //
  // The column is opaque JSON and this repository locks no meaning to its keys.
  // So the kernel reads VALUES and never key names, and it is FAIL-CLOSED: any
  // fact the row states that the source did not is enough to withhold the
  // assertion. It never upgrades an unprovable difference into a conflict,
  // because it cannot prove two opaque values describe the same property.

  const bajaTulangan420: IdentityCatalogCandidate = {
    id: 'cat-baja-420',
    code: null,
    name: 'Baja tulangan 420B',
    type: 'MATERIAL',
    baseUnit: 'Kg',
    status: 'ACTIVE',
    specifications: { diameter: 16 },
  };

  it('A. a partial designation overlap must not authorise the identity', () => {
    // Source says 420B. The row says 420B AND 16. Sharing 420B is not proof
    // that the source meant diameter 16 — the old set-intersection let this
    // resolve.
    const result = run({
      reference: { rawName: 'Baja tulangan 420B', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [bajaTulangan420],
    });

    expect(result.status).not.toBe('RESOLVED');
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.candidates[0].unprovedSpecificationFacts).toContain('16');
  });

  it('B. shared tokens must not hide an extra unproved structured fact', () => {
    const result = run({
      reference: { rawName: 'Baja tulangan 420B Ø13', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [{ ...bajaTulangan420, name: 'Baja tulangan 420B Ø13' }],
    });

    expect(result.status).not.toBe('RESOLVED');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    // 420B and 13 agreeing does not make 16 disappear.
    expect(result.candidates[0].unprovedSpecificationFacts).toContain('16');
  });

  it('C. a non-numeric structured value is a specification too', () => {
    const galvanis: IdentityCatalogCandidate = {
      id: 'cat-baja-galvanis',
      code: null,
      name: 'Baja tulangan',
      type: 'MATERIAL',
      baseUnit: 'Kg',
      status: 'ACTIVE',
      specifications: { finish: 'Galvanis' },
    };
    const result = run({
      reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [galvanis],
    });

    // "No digit" never proved "not a specification". The old rule discarded
    // this value entirely and auto-resolved.
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(result.candidates[0].unprovedSpecificationFacts).toContain('Galvanis');
  });

  it('C2. a structured fact the source DOES state is supported and does not block', () => {
    const galvanis: IdentityCatalogCandidate = {
      id: 'cat-baja-galvanis-2',
      code: null,
      name: 'Baja tulangan galvanis',
      type: 'MATERIAL',
      baseUnit: 'Kg',
      status: 'ACTIVE',
      specifications: { finish: 'Galvanis' },
    };
    const result = run({
      reference: { rawName: 'Baja tulangan galvanis', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [galvanis],
    });

    // Deterministic evidence, not guessed key semantics: every token of the
    // stated fact appears in the source itself.
    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
  });

  it('D. no structured specification behaves exactly as before', () => {
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [{ ...CATALOG_PEKERJA, specifications: null }],
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.candidates[0].specifications).toBeNull();
  });

  it('E. an empty structured specification is the same as none', () => {
    const empty = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [{ ...CATALOG_PEKERJA, specifications: {} }],
    });
    const absent = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [CATALOG_PEKERJA],
    });

    expect(empty.status).toBe('RESOLVED');
    expect(empty.status).toBe(absent.status);
    expect(empty.candidates[0].specificationUnproved).toBe(false);
  });

  it('F. the one metadata shape this repository provably strips is not a blocker', () => {
    // resource-catalog-bootstrap-planner strips `rm02bTestOnly`, which is the
    // only key the repository proves is non-product metadata. It is a boolean:
    // it states no value, so it is harmless without any ignore-list. No other
    // key is special-cased, and nothing broader is assumed.
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [{ ...CATALOG_PEKERJA, specifications: { rm02bTestOnly: true } }],
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.reasonCodes).not.toContain('SPECIFICATION_UNPROVED');
  });

  it('F2. an unrelated STRING value is still withheld — no broad ignore-list is invented', () => {
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [
        { ...CATALOG_PEKERJA, specifications: { keepMe: 'unrelated-value' } },
      ],
    });

    // The repository never proved this key is non-semantic, so SIMPROK does
    // not decide it is. Fail-closed beats a guessed exemption.
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
  });

  it('an opaque structured difference is UNPROVED, never upgraded to CONFLICT', () => {
    // The source says 8; the row's opaque JSON says 10. Nothing proves those
    // two numbers describe the same property, so claiming a contradiction
    // would invent the taxonomy this kernel refuses to invent.
    const angker: IdentityCatalogCandidate = {
      id: 'cat-angker-json',
      code: null,
      name: 'Besi angker',
      type: 'MATERIAL',
      baseUnit: 'Kg',
      status: 'ACTIVE',
      specifications: { diameter: 10 },
    };
    const result = run({
      reference: { rawName: 'Besi angker', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [angker],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(result.reasonCodes).not.toContain('SPECIFICATION_CONFLICT');
  });

  it('a NAME-vs-NAME designation clash is still a genuine conflict', () => {
    // Like compared with like: both sides state the designation in the same
    // kind of statement, so a contradiction here is provable.
    const result = run({
      reference: { rawName: 'Besi angker diameter 8', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [
        {
          id: 'cat-angker-10',
          code: null,
          name: 'Besi angker diameter 10',
          type: 'MATERIAL',
          baseUnit: 'Kg',
          status: 'ACTIVE',
        },
      ],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('SPECIFICATION_CONFLICT');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('nested structured values are read at depth, and booleans still state nothing', () => {
    const nested: IdentityCatalogCandidate = {
      id: 'cat-nested',
      code: null,
      name: 'Pipa',
      type: 'MATERIAL',
      baseUnit: 'M¹',
      status: 'ACTIVE',
      specifications: { dims: { outer: 'Ø 15' }, certified: true },
    };
    const result = run({
      reference: { rawName: 'Pipa', rawCode: null, rawUnit: 'M¹', resourceType: 'MATERIAL' },
      catalogCandidates: [nested],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.candidates[0].unprovedSpecificationFacts).toContain('Ø 15');
    // `certified: true` is a flag with no value and contributes nothing.
    expect(result.candidates[0].unprovedSpecificationFacts).toHaveLength(1);
  });

  // ---------- H. HONEST NOT FOUND ----------
  it('H. NOT_FOUND is reached only after every discovery path came back empty', () => {
    const result = run({
      reference: { rawName: 'Geotextile Woven', rawCode: 'X.99', rawUnit: 'M²', resourceType: 'MATERIAL' },
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toEqual(['RESOURCE_NOT_FOUND']);
    expect(result.candidates).toHaveLength(0);
    expect(result.explanation).toContain('kode sumber');
  });

  // ---------- K. SOURCE CODE COLLISION ----------
  it('K. one source code pointing at two different catalog rows resolves nothing', () => {
    const result = run({
      reference: { rawName: 'Semen', rawCode: 'M.23', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      sourceSightings: [
        sighting({ resourceCatalogId: CATALOG_SEMEN_PORTLAN.id, rawName: 'Semen Portlan', rawCode: 'M.23' }),
        sighting({ resourceCatalogId: CATALOG_SEMEN_TONASA.id, rawName: 'Semen Portland / Tonasa', rawCode: 'M.23' }),
      ],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  // ---------- L. TENANT ----------
  it('L. evidence pointing outside the catalog set the caller scoped can never resolve', () => {
    const result = run({
      reference: { rawName: 'Baja asing', rawCode: 'Z.1', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      // A mapping and a sighting for a catalog row that is NOT in this
      // workspace's candidate set — the caller already excluded it.
      reviewedMappings: [mapping({ resourceCatalogId: 'cat-other-workspace', rawName: 'Baja asing' })],
      sourceSightings: [
        sighting({ resourceCatalogId: 'cat-other-workspace', rawName: 'Baja asing', rawCode: 'Z.1' }),
      ],
    });

    expect(result.status).not.toBe('RESOLVED');
    expect(result.candidates.map((c) => c.resourceCatalogId)).not.toContain('cat-other-workspace');
  });

  it('an inactive catalog row is never a candidate and never resolves', () => {
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [{ ...CATALOG_PEKERJA, status: 'ARCHIVED' }],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  // ---------- M / N. SEPARATION OF CONCERNS ----------
  it('M. identity is decided without consulting the unit at all', () => {
    const wrongUnit = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'Jam', resourceType: 'LABOR' },
    });
    const rightUnit = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
    });

    // Same identity verdict either way — the unit gate lives in UnitKernel and
    // is applied downstream, so identity must not pre-empt or duplicate it.
    expect(wrongUnit.status).toBe('RESOLVED');
    expect(wrongUnit.resolvedResourceCatalogId).toBe(rightUnit.resolvedResourceCatalogId);
  });

  it('N. a resolved identity says nothing about a price existing', () => {
    const result = run({
      reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
    });

    expect(result.status).toBe('RESOLVED');
    // The verdict carries identity only; price absence is a different fact,
    // reported by the price resolver, never as RESOURCE_NOT_FOUND.
    expect(Object.keys(result)).not.toContain('selectedBasicPriceId');
  });

  // ---------- purity ----------
  it('the kernel is pure: identical input yields identical output', () => {
    const input: ResourceIdentityResolutionInput = {
      reference: { rawName: 'Portland Cement', rawCode: 'M.23', rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: ALL_CATALOG,
      sourceSightings: [],
      reviewedMappings: [],
    };

    expect(JSON.stringify(resolveResourceIdentity(input))).toBe(
      JSON.stringify(resolveResourceIdentity(input)),
    );
  });
});

/**
 * RM-03D2 — the exact-name/type REPRESENTATION TIE, and the one fact allowed to
 * settle it.
 *
 * The law being tested is deliberately narrow. Several catalog rows state the
 * same name and the same class; RM-02C1c keeps them apart on purpose, so they
 * are separate canonical REPRESENTATIONS rather than duplicates. The source line
 * usually says which one it meant, in its own unit column, and SIMPROK may read
 * that — but only through the Unit authority, only as CANONICAL UNIT IDENTITY
 * EQUALITY, and only when the answer is unique and every rival is PROVEN
 * different rather than merely unproven.
 *
 * Two failure modes are hunted throughout: turning convertibility into identity
 * evidence, and treating UNKNOWN as proof of difference. Both are false
 * certainty wearing a different hat.
 */
describe('resolveResourceIdentity — RM-03D2 canonical-unit representation tie', () => {
  const UNIT = {
    m3: 'unit-m3',
    kg: 'unit-kg',
    doos: 'unit-doos',
    buah: 'unit-buah',
  } as const;

  const catalogRow = (
    over: Partial<IdentityCatalogCandidate> & { id: string; name: string; baseUnit: string },
  ): IdentityCatalogCandidate => ({
    code: null,
    type: 'MATERIAL',
    status: 'ACTIVE',
    ...over,
  });

  // The Owner's Golden B1-B12 case: "Mortar" (M279) is priced per m3 in B4-B8
  // and per kg in B9-B10, which yields two catalog identities under one name.
  const MORTAR_M3 = catalogRow({ id: 'cat-mortar-m3', name: 'Mortar', baseUnit: 'm3' });
  const MORTAR_KG = catalogRow({ id: 'cat-mortar-kg', name: 'Mortar', baseUnit: 'kg' });
  const MORTAR_TIE = [MORTAR_M3, MORTAR_KG];

  // The same law, from a different Owner workbook entirely — rows 200/201 of
  // BASIC PRICE(1).xlsx, which the production bootstrap planner pins as a
  // permanent same-name/different-unit split.
  const PORSLEN_DOOS = catalogRow({ id: 'cat-porslen-doos', name: 'Porslen', baseUnit: 'Doos' });
  const PORSLEN_BUAH = catalogRow({ id: 'cat-porslen-buah', name: 'Porslen', baseUnit: 'Buah' });

  /** A context-FREE proof: the spelling is unambiguous everywhere. */
  const proven = (rawUnit: string, unitDefinitionId: string): CanonicalUnitIdentityFact => ({
    rawUnit,
    status: 'RESOLVED',
    unitDefinitionId,
    unitCode: rawUnit.toUpperCase(),
    reasonCode: 'EXACT_UNIT_IDENTITY',
    contextScoped: false,
    trustedContext: null,
    matchedAliasIds: [`alias-${rawUnit}`],
  });

  /**
   * A CONTEXT-SCOPED proof: the same spelling means this only because the
   * resource is governed as `trustedContext`. Same verdict, weaker claim.
   */
  const provenInContext = (
    rawUnit: string,
    unitDefinitionId: string,
    trustedContext: string,
    matchedAliasIds: string[] = [`alias-${rawUnit}-${trustedContext.toLowerCase()}`],
  ): CanonicalUnitIdentityFact => ({
    rawUnit,
    status: 'RESOLVED',
    unitDefinitionId,
    unitCode: rawUnit.toUpperCase(),
    reasonCode: 'CONTEXT_SCOPED_UNIT_ALIAS',
    contextScoped: true,
    trustedContext,
    matchedAliasIds,
  });

  const unproven = (rawUnit: string, reasonCode: string): CanonicalUnitIdentityFact => ({
    rawUnit,
    status: 'NEEDS_REVIEW',
    unitDefinitionId: null,
    unitCode: null,
    reasonCode,
    contextScoped: false,
    trustedContext: null,
    matchedAliasIds: [],
  });

  /** The facts the service supplies for a Mortar tie whose units are all known. */
  const MORTAR_UNITS = [proven('m3', UNIT.m3), proven('kg', UNIT.kg)];

  const tie = (
    rawUnit: string | null,
    facts: CanonicalUnitIdentityFact[],
    catalogCandidates: IdentityCatalogCandidate[] = MORTAR_TIE,
    rawName = 'Mortar',
  ) =>
    resolveResourceIdentity({
      reference: { rawName, rawCode: null, rawUnit, resourceType: 'MATERIAL' },
      catalogCandidates,
      sourceSightings: [],
      reviewedMappings: [],
      canonicalUnitIdentities: facts,
    });

  // ---------- B / C. THE REPRESENTATIVE REAL CASE ----------
  it('B. Mortar stated in m3 resolves to the m3 representation', () => {
    const result = tie('m3', MORTAR_UNITS);

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
    expect(result.reasonCodes).toEqual(['EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT']);
    // The audit trail must not read as though one exact candidate had existed.
    expect(result.reasonCodes).not.toContain('EXACT_CANONICAL_MATCH');
    expect(result.explanation).toContain('m3');
    expect(result.explanation).toContain('kg');
  });

  it('C. the same tie stated in kg resolves to the kg representation', () => {
    const result = tie('kg', MORTAR_UNITS);

    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_KG.id);
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
  });

  it('the two verdicts differ ONLY by the source unit — nothing else moved', () => {
    expect(tie('m3', MORTAR_UNITS).resolvedResourceCatalogId).not.toBe(
      tie('kg', MORTAR_UNITS).resolvedResourceCatalogId,
    );
  });

  // ---------- 26. THE SAME LAW, A DIFFERENT RESOURCE ----------
  it('generalises beyond Mortar: Porslen Doos vs Buah is settled the same way', () => {
    const result = tie(
      'Doos',
      [proven('Doos', UNIT.doos), proven('Buah', UNIT.buah)],
      [PORSLEN_DOOS, PORSLEN_BUAH],
      'Porslen',
    );

    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBe(PORSLEN_DOOS.id);
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
  });

  // ---------- A / 5. THE SINGLE-EXACT LAW IS UNTOUCHED ----------
  it('A. a SINGLE exact candidate still resolves even when its unit differs — RM-03D1 law preserved', () => {
    // The Owner's real "Kr : Kerikil / agregat" shape: the source says Kg, the
    // one catalog row says M3. That gap is a Unit Kernel question downstream;
    // it must never overturn an identity that was never ambiguous.
    const kerikil = catalogRow({ id: 'cat-kerikil', name: 'Kerikil', baseUnit: 'M3' });
    const result = tie('Kg', [proven('Kg', UNIT.kg), proven('M3', UNIT.m3)], [kerikil], 'Kerikil');

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe(kerikil.id);
  });

  it('A2. a single exact candidate is unaffected by unit facts being present at all', () => {
    const kerikil = catalogRow({ id: 'cat-kerikil', name: 'Kerikil', baseUnit: 'M3' });
    const withFacts = tie('Kg', [proven('Kg', UNIT.kg), proven('M3', UNIT.m3)], [kerikil], 'Kerikil');
    const withoutFacts = tie('Kg', [], [kerikil], 'Kerikil');

    expect(JSON.stringify(withFacts)).toBe(JSON.stringify(withoutFacts));
  });

  // ---------- D. HEURISTIC CANDIDATES NEVER ENTER THIS AUTHORITY ----------
  it('D. a heuristic (non-exact) candidate set is NEVER promoted, even with a perfectly matching unit', () => {
    // "Mortar Instan" nominates BOTH Mortar rows by token containment. Its unit
    // matches exactly one of them — and that must change nothing, because the
    // name never matched exactly and RM-03D2 only runs on an exact tie.
    const result = tie('m3', MORTAR_UNITS, MORTAR_TIE, 'Mortar Instan');

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).toBe('EVIDENCE_CANDIDATE');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.reasonCodes).toContain('MULTIPLE_CANDIDATES_NEEDS_REVIEW');
    expect(result.reasonCodes).not.toContain('EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT');
  });

  it('D2. the Morfar spelling variant is not promoted by a matching unit either', () => {
    const result = tie('m3', MORTAR_UNITS, MORTAR_TIE, 'Morfar M279');

    expect(result.status).not.toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  // ---------- E / F / G. THE SOURCE UNIT MUST BE PROVEN ----------
  it('E. an UNKNOWN source unit leaves the tie open', () => {
    const result = tie('mystery', [unproven('mystery', 'UNKNOWN_UNIT_ALIAS'), ...MORTAR_UNITS]);

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).toBe('HUMAN_REVIEW_REQUIRED');
    expect(result.reasonCodes).toEqual([
      'MULTIPLE_CANDIDATES_NEEDS_REVIEW',
      'UNIT_CONTEXT_SOURCE_UNIT_UNPROVED',
    ]);
    expect(result.explanation).toContain('UNKNOWN_UNIT_ALIAS');
  });

  it('F. an AMBIGUOUS source unit leaves the tie open and says which uncertainty it was', () => {
    const result = tie('x', [unproven('x', 'AMBIGUOUS_UNIT_ALIAS'), ...MORTAR_UNITS]);

    expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
    expect(result.explanation).toContain('AMBIGUOUS_UNIT_ALIAS');
  });

  it('G. a CONTEXT-REQUIRED source unit with no trusted context leaves the tie open', () => {
    const result = tie('jam', [unproven('jam', 'CONTEXT_REQUIRED_UNIT_ALIAS'), ...MORTAR_UNITS]);

    expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
    expect(result.explanation).toContain('CONTEXT_REQUIRED_UNIT_ALIAS');
  });

  it('G2. a source that states NO unit is a different fact from one that states an unprovable unit', () => {
    const unstated = tie(null, MORTAR_UNITS);

    expect(unstated.reasonCodes).toEqual([
      'MULTIPLE_CANDIDATES_NEEDS_REVIEW',
      'UNIT_CONTEXT_SOURCE_UNIT_UNSTATED',
    ]);
    // and it is NOT collapsed into the unproved code
    expect(unstated.reasonCodes).not.toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
  });

  it('G3. a blank source unit is treated as unstated, never as a spelling to look up', () => {
    expect(tie('   ', MORTAR_UNITS).reasonCodes).toContain(
      'UNIT_CONTEXT_SOURCE_UNIT_UNSTATED',
    );
  });

  it('a source unit with NO fact supplied at all is unproved, never assumed', () => {
    const result = tie('m3', []);

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
  });

  // ---------- H / 12. UNKNOWN IS NOT NEGATIVE PROOF ----------
  it('H. an unproved CANDIDATE unit keeps the tie open even though the other candidate matches exactly', () => {
    // This is the load-bearing false-certainty test. The m3 row matches the
    // source perfectly. The kg row's unit is merely UNKNOWN — which is NOT
    // proof that it is a different unit, so it cannot be excluded, so nothing
    // may be asserted.
    const result = tie('m3', [proven('m3', UNIT.m3), unproven('kg', 'UNKNOWN_UNIT_ALIAS')]);

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).toBe('HUMAN_REVIEW_REQUIRED');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.reasonCodes).toEqual([
      'MULTIPLE_CANDIDATES_NEEDS_REVIEW',
      'UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED',
    ]);
    expect(result.explanation).toContain('kg');
  });

  it('H2. a candidate whose unit fact was simply never supplied is also unprovable, not excluded', () => {
    const result = tie('m3', [proven('m3', UNIT.m3)]);

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED');
  });

  // ---------- I / J. UNIQUENESS ----------
  it('I. two tied representations sharing ONE canonical unit stay ambiguous', () => {
    const m3Upper = catalogRow({ id: 'cat-mortar-m3-upper', name: 'Mortar', baseUnit: 'M3' });
    const result = tie(
      'm3',
      [proven('m3', UNIT.m3), proven('M3', UNIT.m3)],
      [MORTAR_M3, m3Upper],
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.reasonCodes).toContain(
      'UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS',
    );
  });

  it('J. a source unit matching NO representation is reported as exactly that', () => {
    const result = tie(
      'Zak',
      [proven('Zak', 'unit-zak'), ...MORTAR_UNITS],
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('UNIT_CONTEXT_NO_MATCHING_REPRESENTATION');
    // "no representation uses this unit" is NOT "this resource does not exist"
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
    expect(result.candidates).toHaveLength(2);
  });

  // ---------- K / L. CONVERSION IS NOT IDENTITY EVIDENCE ----------
  it('K. a relation that exists ONLY through conversion never establishes identity', () => {
    // m3 and kg are convertible for a real mortar via density. The kernel is
    // given the canonical identities only, so a source in kg against an m3-only
    // catalog set finds no representation — convertibility is invisible to it.
    const m3Only = catalogRow({ id: 'cat-mortar-m3-b', name: 'Mortar', baseUnit: 'M3' });
    const result = tie(
      'kg',
      [proven('kg', UNIT.kg), proven('m3', UNIT.m3), proven('M3', UNIT.m3)],
      [MORTAR_M3, m3Only],
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('UNIT_CONTEXT_NO_MATCHING_REPRESENTATION');
  });

  it('L. candidate-specific conversion bait cannot make a candidate prove itself', () => {
    // The hostile shape: a caller that used the FULL unit resolver would find
    // kg "resolvable" against the kg row via a resource-specific rule scoped to
    // that very row, and would select it. The kernel's contract has nowhere to
    // put such a fact — canonicalUnitIdentities carries no resourceCatalogId —
    // so circular self-proof is unrepresentable rather than merely avoided.
    //
    // The allow-list is exhaustive on purpose: it fails the moment ANY new key
    // appears, so a future field that could bind a unit fact to one candidate —
    // `resourceCatalogId`, a conversion rule, a quantity factor — has to be
    // argued for here rather than slipped in. The provenance RM-03D2's closeout
    // added is all about the UNIT's own authority (its code, whether a
    // context-scoped alias answered, which trusted class it depended on, which
    // alias rows decided it) and names no resource, so circular self-proof stays
    // unrepresentable rather than merely unused.
    const facts = MORTAR_UNITS as ReadonlyArray<CanonicalUnitIdentityFact>;
    for (const fact of facts) {
      expect(Object.keys(fact).sort()).toEqual(
        [
          'rawUnit',
          'status',
          'unitDefinitionId',
          'unitCode',
          'reasonCode',
          'contextScoped',
          'trustedContext',
          'matchedAliasIds',
        ].sort(),
      );
      expect(JSON.stringify(fact)).not.toContain('cat-mortar');
    }
    // And a source unit shared with no representation still refuses.
    expect(tie('Sak', [proven('Sak', 'unit-sak'), ...MORTAR_UNITS]).status).toBe(
      'NEEDS_REVIEW',
    );
  });

  // ---------- M / N. SPECIFICATION SAFETY STILL RUNS ----------
  it('M. a specification CONTRADICTION survives unit disambiguation as UNRESOLVED', () => {
    const angker8 = catalogRow({
      id: 'cat-angker-8',
      name: 'Besi angker diameter 10',
      baseUnit: 'm3',
    });
    const angker8Kg = catalogRow({
      id: 'cat-angker-8-kg',
      name: 'Besi angker diameter 10',
      baseUnit: 'kg',
    });
    const result = tie(
      'm3',
      MORTAR_UNITS,
      [angker8, angker8Kg],
      'Besi angker diameter 8',
    );

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toEqual(['SPECIFICATION_CONFLICT']);
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('N. an UNPROVED specification survives unit disambiguation as NEEDS_REVIEW', () => {
    const specced = catalogRow({
      id: 'cat-mortar-m3-spec',
      name: 'Mortar',
      baseUnit: 'm3',
      specifications: { finish: 'Galvanis' },
    });
    const result = tie('m3', MORTAR_UNITS, [specced, MORTAR_KG]);

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).toBe('EVIDENCE_CANDIDATE');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.reasonCodes).toEqual([
      'STRONG_CANDIDATE_NEEDS_REVIEW',
      'SPECIFICATION_UNPROVED',
    ]);
    expect(result.explanation).toContain('Galvanis');
  });

  // ---------- O / P. THE EXISTING GATES STILL GATE ----------
  it('O. a same-name row of a FOREIGN type never joins the tie', () => {
    const labourMortar = catalogRow({
      id: 'cat-mortar-labor',
      name: 'Mortar',
      baseUnit: 'm3',
      type: 'LABOR',
    });
    const result = tie('m3', MORTAR_UNITS, [MORTAR_M3, labourMortar]);

    // Only ONE MATERIAL row remains, so this is a single exact match again.
    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
  });

  it('P. an INACTIVE tied row is not a candidate, and cannot be resolved to', () => {
    const archivedM3 = catalogRow({
      id: 'cat-mortar-m3-archived',
      name: 'Mortar',
      baseUnit: 'm3',
      status: 'ARCHIVED',
    });
    const result = tie('m3', MORTAR_UNITS, [archivedM3, MORTAR_KG]);

    // The archived m3 row is gone, so the kg row is a single exact match and
    // RM-03D1's law — which does not consult the unit — applies unchanged.
    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.resolvedResourceCatalogId).toBe(MORTAR_KG.id);
  });

  it('P2. an inactive row can never win the tie it would have won when active', () => {
    const archivedM3: IdentityCatalogCandidate = { ...MORTAR_M3, status: 'ARCHIVED' };
    const anotherKg = catalogRow({ id: 'cat-mortar-kg-2', name: 'Mortar', baseUnit: 'kg' });
    const result = tie('m3', MORTAR_UNITS, [archivedM3, MORTAR_KG, anotherKg]);

    expect(result.resolvedResourceCatalogId).not.toBe(MORTAR_M3.id);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('UNIT_CONTEXT_NO_MATCHING_REPRESENTATION');
  });

  // ---------- Q / 28. DETERMINISM AND ORDER-INDEPENDENCE ----------
  it('Q. the verdict does not depend on candidate order', () => {
    const forward = tie('m3', MORTAR_UNITS, [MORTAR_M3, MORTAR_KG]);
    const reversed = tie('m3', MORTAR_UNITS, [MORTAR_KG, MORTAR_M3]);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it('Q2. the verdict does not depend on unit-fact order', () => {
    const forward = tie('m3', [proven('m3', UNIT.m3), proven('kg', UNIT.kg)]);
    const reversed = tie('m3', [proven('kg', UNIT.kg), proven('m3', UNIT.m3)]);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it('Q3. identical input yields byte-identical output', () => {
    expect(JSON.stringify(tie('m3', MORTAR_UNITS))).toBe(
      JSON.stringify(tie('m3', MORTAR_UNITS)),
    );
  });

  // ---------- the tie predicate the I/O layer depends on ----------
  it('isExactRepresentationTie is true ONLY for an unsettled Level-1 tie', () => {
    expect(isExactRepresentationTie(tie('m3', []))).toBe(true);
    // settled by unit context
    expect(isExactRepresentationTie(tie('m3', MORTAR_UNITS))).toBe(false);
    // a Level-2 heuristic multi-candidate set is NOT a representation tie
    expect(isExactRepresentationTie(tie('m3', [], MORTAR_TIE, 'Mortar Instan'))).toBe(
      false,
    );
    // and neither is a plain single exact match
    expect(isExactRepresentationTie(tie('m3', [], [MORTAR_M3]))).toBe(false);
  });

  // ---------- ADVERSARIAL (§27) ----------
  describe('adversarial refutation — nothing unproven may become RESOLVED', () => {
    it('duplicate identical evidence facts do not create a false majority', () => {
      const result = tie('m3', [
        proven('m3', UNIT.m3),
        proven('m3', UNIT.m3),
        proven('kg', UNIT.kg),
      ]);

      expect(result.status).toBe('RESOLVED');
      expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
    });

    it('a duplicated catalog row sharing one canonical unit stays ambiguous', () => {
      const twin = { ...MORTAR_M3, id: 'cat-mortar-m3-twin' };
      const result = tie('m3', MORTAR_UNITS, [MORTAR_M3, twin, MORTAR_KG]);

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain(
        'UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS',
      );
    });

    it('a three-way tie with one unprovable unit refuses, however good the rest look', () => {
      const zak = catalogRow({ id: 'cat-mortar-zak', name: 'Mortar', baseUnit: 'Zak' });
      const result = tie(
        'm3',
        [proven('m3', UNIT.m3), proven('kg', UNIT.kg), unproven('Zak', 'AMBIGUOUS_UNIT_ALIAS')],
        [MORTAR_M3, MORTAR_KG, zak],
      );

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED');
    });

    it('a fact resolved for one spelling is never read as the answer for another', () => {
      // Only "m3" was proven. The catalog row spells it "M3". Nothing may be
      // inferred across the two spellings inside this kernel — the Unit
      // authority resolves both, or the tie stays open.
      const upper = catalogRow({ id: 'cat-mortar-M3', name: 'Mortar', baseUnit: 'M3' });
      const result = tie('m3', [proven('m3', UNIT.m3), proven('kg', UNIT.kg)], [upper, MORTAR_KG]);

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED');
    });

    it('a RESOLVED fact carrying a null unit id is treated as unproven', () => {
      const result = tie('m3', [
        { rawUnit: 'm3', status: 'RESOLVED', unitDefinitionId: null, unitCode: null, reasonCode: null, contextScoped: false, trustedContext: null, matchedAliasIds: [] },
        proven('kg', UNIT.kg),
      ]);

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
    });

    it('an empty tied catalog set never reaches this branch at all', () => {
      const result = tie('m3', MORTAR_UNITS, [], 'Mortar');

      expect(result.status).toBe('UNRESOLVED');
      expect(result.reasonCodes).toEqual(['RESOURCE_NOT_FOUND']);
    });

    it('no tie verdict ever resolves to a row outside the tied set', () => {
      const outsider = catalogRow({ id: 'cat-outsider', name: 'Semen', baseUnit: 'm3' });
      const result = tie('m3', MORTAR_UNITS, [MORTAR_M3, MORTAR_KG, outsider]);

      expect(result.resolvedResourceCatalogId).toBe(MORTAR_M3.id);
      expect(result.resolvedResourceCatalogId).not.toBe(outsider.id);
    });

    // ---------- THE AUTHORITY STORY SURVIVES THE DECISION (§7, §10) ----------
    //
    // A correct verdict whose reason cannot be reconstructed afterwards is not
    // Super Grade-A. These pin the four questions a reviewer will actually have:
    // what did the source state, what canonical unit was proved from it, which
    // representation shared that unit, and did a trusted context have to be
    // assumed to read either one.
    describe('unit-authority provenance', () => {
      it('names the source unit, the canonical unit, the deciding alias and the winning row', () => {
        const result = tie('m3', MORTAR_UNITS);

        expect(result.status).toBe('RESOLVED');
        // 1. what the source stated
        expect(result.explanation).toContain('"m3"');
        // 2. what canonical unit was proved from it, and by what authority
        expect(result.explanation).toContain('unit canonical M3');
        expect(result.explanation).toContain('EXACT_UNIT_IDENTITY');
        // 3. which representation shared it — and that others existed at all
        expect(result.explanation).toContain(MORTAR_M3.id);
        expect(result.explanation).toContain('2 representasi');
        // 4. the deciding alias evidence, by stable id
        expect(result.explanation).toContain('alias-m3');
        // …and the specification check is stated as having run, not implied.
        expect(result.explanation).toContain('spesifikasi');
      });

      it('states the trusted context when — and ONLY when — the meaning depended on it', () => {
        const JAM = catalogRow({ id: 'cat-pekerja-jam', name: 'Pekerja', baseUnit: 'jam', type: 'LABOR' });
        const OH = catalogRow({ id: 'cat-pekerja-oh', name: 'Pekerja', baseUnit: 'OH', type: 'LABOR' });
        const scoped = resolveResourceIdentity({
          reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'jam', resourceType: 'LABOR' },
          catalogCandidates: [JAM, OH],
          sourceSightings: [],
          reviewedMappings: [],
          canonicalUnitIdentities: [
            provenInContext('jam', 'unit-person-hour', 'LABOR', ['alias-jam-labor']),
            provenInContext('OH', 'unit-person-day', 'LABOR', ['alias-oh-labor']),
          ],
        });

        expect(scoped.status).toBe('RESOLVED');
        expect(scoped.resolvedResourceCatalogId).toBe(JAM.id);
        // The weaker claim is recorded AS the weaker claim: this meaning holds
        // because the resource is governed as LABOR, not universally.
        expect(scoped.explanation).toContain('CONTEXT_SCOPED_UNIT_ALIAS');
        expect(scoped.explanation).toContain('konteks tepercaya LABOR');
      });

      it('a context-FREE proof is never dressed up as context-scoped', () => {
        // §6, the other direction. Inventing a context here would make a
        // globally valid meaning read as narrower than it is — false provenance
        // is a defect even when it makes the system look more careful.
        const result = tie('m3', MORTAR_UNITS);

        expect(result.explanation).not.toContain('konteks tepercaya');
        expect(result.explanation).toContain('EXACT_UNIT_IDENTITY');
      });

      it('a refusal names the unit evidence just as fully as a success does', () => {
        const result = tie('m3', [unproven('m3', 'FOREIGN_CONTEXT_UNIT_ALIAS'), proven('kg', UNIT.kg)]);

        expect(result.status).toBe('NEEDS_REVIEW');
        expect(result.reasonCodes).toContain('UNIT_CONTEXT_SOURCE_UNIT_UNPROVED');
        // The truthful diagnosis reaches the identity trail intact: the reviewer
        // learns the spelling is known-but-inapplicable, not unheard of.
        expect(result.explanation).toContain('FOREIGN_CONTEXT_UNIT_ALIAS');
      });

      it('duplicate alias evidence cannot make provenance grow or wobble', () => {
        // §25.14. The Unit authority canonicalises its alias list, so the same
        // evidence must serialise identically however many times a spelling was
        // asked about and in whatever order the facts arrive.
        const facts = [proven('m3', UNIT.m3), proven('kg', UNIT.kg)];
        const forwards = tie('m3', facts);
        const backwards = tie('m3', [...facts].reverse());

        expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
      });
    });
  });
});

/**
 * SAME EVIDENCE → SAME OUTPUT, when the evidence is a dead heat.
 *
 * `decidedAt` is a plain timestamp and two reviewed mappings can genuinely
 * share one — same batch, same second. Until this closeout, the winner was then
 * whichever the database returned first, so the reported reviewer, reason and
 * timestamp moved with row order. The RAB pre-lock gate re-runs this resolution
 * and compares it against the frozen one, so an order-dependent field there can
 * fail a lawful lock.
 */
describe('resolveResourceIdentity — prior human decision determinism', () => {
  const AMBIGUOUS: IdentityCatalogCandidate = {
    id: 'cat-determinism',
    code: null,
    name: 'Semen Portlan Deterministik',
    type: 'MATERIAL',
    baseUnit: 'Kg',
    status: 'ACTIVE',
  };
  const SAME_INSTANT = '2026-08-07T09:15:00.000Z';

  // Same catalog row, same instant, everything else different — the exact shape
  // that used to be decided by array order.
  const DECISION_A = mapping({
    mappingId: 'aaaa-1111',
    resourceCatalogId: AMBIGUOUS.id,
    rawName: 'Semen',
    decidedAt: SAME_INSTANT,
    reviewerAccountId: 'acct-andi',
    reason: 'keputusan A',
  });
  const DECISION_B = mapping({
    mappingId: 'bbbb-2222',
    resourceCatalogId: AMBIGUOUS.id,
    rawName: 'Semen',
    decidedAt: SAME_INSTANT,
    reviewerAccountId: 'acct-budi',
    reason: 'keputusan B',
  });

  const withMappings = (reviewedMappings: ReviewedMappingEvidence[]) =>
    resolveResourceIdentity({
      reference: { rawName: 'Semen', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [AMBIGUOUS],
      sourceSightings: [],
      reviewedMappings,
    });

  it('equal decidedAt resolves the SAME way in either input order', () => {
    const forwards = withMappings([DECISION_A, DECISION_B]);
    const backwards = withMappings([DECISION_B, DECISION_A]);

    expect(forwards.candidates[0].priorHumanDecision).not.toBeNull();
    // Not merely "both non-null" — byte-identical verdicts, metadata included.
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it('the tie-break is the decision id, not the reviewer or the reason', () => {
    const forwards = withMappings([DECISION_A, DECISION_B]);

    expect(forwards.candidates[0].priorHumanDecision).toMatchObject({
      reviewerAccountId: 'acct-andi',
      reason: 'keputusan A',
      decidedAt: SAME_INSTANT,
    });
  });

  it('a genuinely newer decision still wins — recency is not sacrificed to order', () => {
    const newer = mapping({
      mappingId: 'zzzz-9999',
      resourceCatalogId: AMBIGUOUS.id,
      rawName: 'Semen',
      decidedAt: '2026-08-09T00:00:00.000Z',
      reviewerAccountId: 'acct-citra',
      reason: 'keputusan terbaru',
    });

    for (const order of [
      [DECISION_A, DECISION_B, newer],
      [newer, DECISION_B, DECISION_A],
      [DECISION_B, newer, DECISION_A],
    ]) {
      expect(withMappings(order).candidates[0].priorHumanDecision).toMatchObject({
        reviewerAccountId: 'acct-citra',
        decidedAt: '2026-08-09T00:00:00.000Z',
      });
    }
  });

  it('determinism grants the reviewed mapping NO new authority', () => {
    // §13. The whole point of making this deterministic is auditability, not
    // promotion: two same-name decisions still refuse to assert an identity.
    const result = withMappings([DECISION_A, DECISION_B]);

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.authority).toBe('EVIDENCE_CANDIDATE');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.authority).not.toBe('VERIFIED_MAPPING_REUSED');
  });
});
