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
  ResourceIdentityResolutionInput,
  IdentityCatalogCandidate,
  SourceSightingEvidence,
  ReviewedMappingEvidence,
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
  // The column is opaque JSON with no identity contract in this repository, so
  // the kernel reads VALUES and never key names. What it must not do is ignore
  // it: a row stating a grade and a diameter must not be auto-resolved against
  // a source that stated neither.

  it('D. a structured specification that contradicts the source blocks the match', () => {
    const angker: IdentityCatalogCandidate = {
      id: 'cat-angker',
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
    // The names are identical; only the structured spec disagrees with the
    // source, and that alone must be enough to stop the assertion.
    const withSourceDesignation = run({
      reference: { rawName: 'Besi angker diameter 8', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [angker],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(withSourceDesignation.status).toBe('UNRESOLVED');
    expect(withSourceDesignation.reasonCodes).toContain('SPECIFICATION_CONFLICT');
    expect(withSourceDesignation.resolvedResourceCatalogId).toBeNull();
  });

  it('E. an exact name whose catalog row is materially more specific is unproven, not asserted', () => {
    const bjts: IdentityCatalogCandidate = {
      id: 'cat-bjts-structured',
      code: null,
      name: 'Baja tulangan',
      type: 'MATERIAL',
      baseUnit: 'Kg',
      status: 'ACTIVE',
      specifications: { grade: 'BjTS 420B', diameter: 13 },
    };
    const result = run({
      reference: { rawName: 'Baja tulangan', rawCode: null, rawUnit: 'Kg', resourceType: 'MATERIAL' },
      catalogCandidates: [bjts],
    });

    // Before this fix the identical name auto-resolved and the grade/diameter
    // were silently assumed to be what the source meant.
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('SPECIFICATION_UNPROVED');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.candidates[0].specificationUnproved).toBe(true);
    // The reviewer sees exactly what the row claims about itself.
    expect(result.candidates[0].specifications).toEqual({
      grade: 'BjTS 420B',
      diameter: 13,
    });
  });

  it('F. opaque, non-identity metadata never becomes a false blocker', () => {
    const pekerjaWithMetadata: IdentityCatalogCandidate = {
      ...CATALOG_PEKERJA,
      // Exactly the shapes this repository actually writes: a test-only marker
      // and an unrelated string. Neither states a designation.
      specifications: { rm02bTestOnly: true, keepMe: 'unrelated-value' },
    };
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [pekerjaWithMetadata],
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.authority).toBe('EXACT_CANONICAL_MATCH');
    expect(result.reasonCodes).not.toContain('SPECIFICATION_UNPROVED');
  });

  it('F2. a null specifications column behaves exactly as before', () => {
    const result = run({
      reference: { rawName: 'Pekerja', rawCode: null, rawUnit: 'OH', resourceType: 'LABOR' },
      catalogCandidates: [{ ...CATALOG_PEKERJA, specifications: null }],
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.candidates[0].specifications).toBeNull();
  });

  it('nested specification values are read, and booleans still state nothing', () => {
    const nested: IdentityCatalogCandidate = {
      id: 'cat-nested',
      code: null,
      name: 'Pipa',
      type: 'MATERIAL',
      baseUnit: 'M¹',
      status: 'ACTIVE',
      specifications: { dims: { outer: 'Ø 15' }, certified: true },
    };
    const conflicting = run({
      reference: { rawName: 'Pipa 20', rawCode: null, rawUnit: 'M¹', resourceType: 'MATERIAL' },
      catalogCandidates: [nested],
    });

    expect(conflicting.status).toBe('UNRESOLVED');
    expect(conflicting.reasonCodes).toContain('SPECIFICATION_CONFLICT');
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
