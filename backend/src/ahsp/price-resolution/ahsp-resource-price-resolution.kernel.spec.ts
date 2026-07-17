/**
 * SIMPROK — AHSP Resource Price Resolution Kernel — Focused Unit Tests
 * BP-AHSP-PHASE-1: Deterministic Resource Price Resolution Proof
 *
 * Tests prove the following required cases from the gate document (§8):
 *  1.  Pekerja / LABOR / OH resolves to Pekerja / LABOR / Org/Hari + one Basic Price
 *  2.  Case and surrounding whitespace do not break the exact proof
 *  3.  Mandor does not resolve to Pekerja
 *  4.  LABOR does not resolve to a MATERIAL catalog
 *  5.  OH does not resolve to unsupported unit "Jam"
 *  6.  sak does not resolve to kg; package conversion is outside scope
 *  7.  Multiple exact ResourceCatalog candidates → NEEDS_REVIEW
 *  8.  Multiple Basic Prices for the resolved catalog → NEEDS_REVIEW; kernel does not select
 *  9.  No matching Basic Price → UNRESOLVED
 * 10.  A very high nominal price resolves exactly the same way; no price-based warning
 * 11.  Unrelated Basic Prices from another ResourceCatalog are never selected
 * 12.  Input decimal strings returned exactly without conversion to JavaScript number
 * PM-REVISE new tests:
 * 13.  Pekerja/OH + catalog Org/Hari + Basic Price unit Jam → UNRESOLVED / BASIC_PRICE_UNIT_NOT_SUPPORTED
 * 14.  One Org/Hari price + one Jam price for same resource → only Org/Hari selected, not NEEDS_REVIEW
 * 15.  Two labor-day-compatible prices → NEEDS_REVIEW (unchanged behavior)
 * 16.  Basic Price unit case/whitespace variations → still RESOLVED
 */

import {
  resolveAhspResourcePrice,
  AhspResourceResolutionInput,
  ResourceCatalogCandidate,
  BasicPriceCandidate,
} from './ahsp-resource-price-resolution.kernel';

const VALIDATED_PERSON_DAY_PRICE_UNIT = {
  status: 'RESOLVED',
  canonicalUnitCode: 'PERSON_DAY',
  quantityFactor: '1',
  priceOperation: 'IDENTITY',
} as const;

// ============================================================
// SHARED TEST FIXTURES
// ============================================================

const CATALOG_PEKERJA: ResourceCatalogCandidate = {
  id: 'catalog-pekerja-uuid-001',
  code: 'LBR-001',
  name: 'Pekerja',
  type: 'LABOR',
  baseUnit: 'Org/Hari',
};

const CATALOG_MANDOR: ResourceCatalogCandidate = {
  id: 'catalog-mandor-uuid-002',
  code: 'LBR-002',
  name: 'Mandor',
  type: 'LABOR',
  baseUnit: 'Org/Hari',
};

const CATALOG_PEKERJA_MATERIAL: ResourceCatalogCandidate = {
  id: 'catalog-pekerja-material-uuid-003',
  code: 'MAT-001',
  name: 'Pekerja',
  type: 'MATERIAL',
  baseUnit: 'kg',
};

const CATALOG_PASIR: ResourceCatalogCandidate = {
  id: 'catalog-pasir-uuid-004',
  code: 'MAT-002',
  name: 'Pasir Beton',
  type: 'MATERIAL',
  baseUnit: 'kg',
};

const PRICE_PEKERJA_STANDARD: BasicPriceCandidate = {
  id: 'price-pekerja-uuid-001',
  resourceId: 'catalog-pekerja-uuid-001',
  value: '120000.00',
  sourceOrigin: 'GOVERNMENT',
  unit: 'Org/Hari',
  unitResolution: { status: 'RESOLVED', canonicalUnitCode: 'PERSON_DAY', quantityFactor: '1', priceOperation: 'IDENTITY' },
};

const PRICE_PEKERJA_ALTERNATIVE: BasicPriceCandidate = {
  id: 'price-pekerja-uuid-002',
  resourceId: 'catalog-pekerja-uuid-001',
  value: '135000.00',
  // FIELD_REPORT is the correct PriceSourceOrigin enum value for this fixture.
  // MARKET_SURVEY is not a valid PriceSourceOrigin in the repository schema.
  sourceOrigin: 'FIELD_REPORT',
  unit: 'Org/Hari',
  unitResolution: { status: 'RESOLVED', canonicalUnitCode: 'PERSON_DAY', quantityFactor: '1', priceOperation: 'IDENTITY' },
};

const PRICE_MANDOR: BasicPriceCandidate = {
  id: 'price-mandor-uuid-003',
  resourceId: 'catalog-mandor-uuid-002',
  value: '180000.00',
  sourceOrigin: 'GOVERNMENT',
  unit: 'Org/Hari',
  unitResolution: { status: 'RESOLVED', canonicalUnitCode: 'PERSON_DAY', quantityFactor: '1', priceOperation: 'IDENTITY' },
};

const BASE_INPUT: Omit<
  AhspResourceResolutionInput,
  'resourceCatalogCandidates' | 'eligibleBasicPriceCandidates'
> = {
  projectId: 'project-test-uuid-001',
  ahspVersionId: 'ahsp-version-test-uuid-001',
  ahspResourceId: 'ahsp-resource-test-uuid-001',
  rawResourceRef: 'Pekerja',
  resourceType: 'LABOR',
  ahspUnit: 'OH',
  validatedUnitResolution: {
    status: 'RESOLVED',
    canonicalUnitCode: 'PERSON_DAY',
    quantityFactor: '1',
    rawSourceUnit: 'OH',
    rawTargetUnit: 'Org/Hari',
  },
};

// ============================================================
// TESTS
// ============================================================

describe('resolveAhspResourcePrice — Phase 1 Deterministic Kernel', () => {
  // ----------------------------------------------------------
  // Test 1: Golden path — Pekerja / LABOR / OH resolves fully
  // ----------------------------------------------------------
  it('1. Pekerja / LABOR / OH resolves to Pekerja / LABOR / Org/Hari catalog and one Basic Price', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    expect(result.resolvedResourceCatalogId).toBe(CATALOG_PEKERJA.id);
    expect(result.selectedBasicPriceId).toBe(PRICE_PEKERJA_STANDARD.id);
    expect(result.selectionStatus).toBe('AUTO_SELECTED');
    expect(result.canonicalUnit).toBe('PERSON_DAY');
    expect(result.conversionFactor).toBe('1');
    expect(result.adaptedPriceValue).toBe('120000.00');
    expect(result.sourcePriceValue).toBe('120000.00');
    expect(result.ahspUnit).toBe('OH');
    expect(result.sourceUnit).toBe('Org/Hari');
    expect(result.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH');
    expect(result.reasonCodes).toContain('RESOURCE_TYPE_MATCH');
    expect(result.reasonCodes).toContain('LABOR_DAY_UNIT_EQUIVALENT');
    expect(result.reasonCodes).toContain('SINGLE_ELIGIBLE_BASIC_PRICE');
    expect(result.explanation).toContain('Pekerja');
    expect(result.explanation).toContain('OH');
  });

  // ----------------------------------------------------------
  // Test 2: Case and surrounding whitespace do not break resolution
  // ----------------------------------------------------------
  it('2. Case and surrounding whitespace do not break the exact proof', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      rawResourceRef: '  PEKERJA  ',
      ahspUnit: '  oh  ',
      resourceCatalogCandidates: [{ ...CATALOG_PEKERJA, name: 'pekerja', baseUnit: 'orang/hari' }],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.reasonCodes).toContain('LABOR_DAY_UNIT_EQUIVALENT');
  });

  // ----------------------------------------------------------
  // Test 3: Mandor does not resolve to Pekerja
  // ----------------------------------------------------------
  it('3. Mandor does not resolve to Pekerja catalog entry', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      rawResourceRef: 'Mandor',
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('NO_CATALOG_CANDIDATE');
  });

  // ----------------------------------------------------------
  // Test 4: LABOR does not resolve to a MATERIAL catalog
  // ----------------------------------------------------------
  it('4. LABOR resource type does not resolve to a MATERIAL catalog entry', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      rawResourceRef: 'Pekerja',
      resourceType: 'LABOR',
      // Catalog has the same name but MATERIAL type
      resourceCatalogCandidates: [CATALOG_PEKERJA_MATERIAL],
      eligibleBasicPriceCandidates: [],
    });

    expect(result.status).toBe('UNRESOLVED');
    // Named RESOURCE_TYPE_MISMATCH because the name matched but type did not
    expect(result.reasonCodes).toContain('RESOURCE_TYPE_MISMATCH');
    expect(result.explanation).toContain('tipe');
  });

  // ----------------------------------------------------------
  // Test 5: OH does not resolve to unsupported unit "Jam"
  // ----------------------------------------------------------
  it('5. OH does not resolve when catalog baseUnit is unsupported "Jam"', () => {
    const catalogJam: ResourceCatalogCandidate = {
      ...CATALOG_PEKERJA,
      baseUnit: 'Jam',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      validatedUnitResolution: { ...BASE_INPUT.validatedUnitResolution, status: 'NEEDS_REVIEW' },
      resourceCatalogCandidates: [catalogJam],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('UNIT_NOT_SUPPORTED');
    expect(result.explanation).toContain('labor-day');
  });

  // ----------------------------------------------------------
  // Test 6: sak does not resolve to kg; package conversion outside scope
  // ----------------------------------------------------------
  it('6. sak AHSP unit does not resolve to kg catalog unit (package conversion outside Phase 1 scope)', () => {
    const catalogKg: ResourceCatalogCandidate = {
      id: 'catalog-semen-uuid-001',
      code: 'MAT-010',
      name: 'Semen',
      type: 'MATERIAL',
      baseUnit: 'kg',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      rawResourceRef: 'Semen',
      resourceType: 'MATERIAL',
      ahspUnit: 'sak',
      validatedUnitResolution: { ...BASE_INPUT.validatedUnitResolution, status: 'NEEDS_REVIEW' },
      resourceCatalogCandidates: [catalogKg],
      eligibleBasicPriceCandidates: [],
    });

    // sak is not a labor-day unit, so unit check fails
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('UNIT_NOT_SUPPORTED');
  });

  // ----------------------------------------------------------
  // Test 7: Multiple exact ResourceCatalog candidates → NEEDS_REVIEW
  // ----------------------------------------------------------
  it('7. Multiple exact ResourceCatalog name+type candidates return NEEDS_REVIEW', () => {
    const catalogPekerja2: ResourceCatalogCandidate = {
      id: 'catalog-pekerja-uuid-999',
      code: 'LBR-099',
      name: 'Pekerja',
      type: 'LABOR',
      baseUnit: 'Org/Hari',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA, catalogPekerja2],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_CATALOG_CANDIDATES');
    expect(result.explanation).toContain('tinjauan manual');
  });

  // ----------------------------------------------------------
  // Test 8: Multiple Basic Prices for resolved catalog → NEEDS_REVIEW
  //         Kernel does not select by price or array order
  // ----------------------------------------------------------
  it('8. Multiple Basic Prices for the resolved catalog return NEEDS_REVIEW; kernel does not select', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD, PRICE_PEKERJA_ALTERNATIVE],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_BASIC_PRICE_CANDIDATES');
    // Must NOT have selected either price
    if (result.status === 'NEEDS_REVIEW') {
      expect((result as any).selectedBasicPriceId).toBeUndefined();
    }
    expect(result.explanation).toContain('multi-harga');
  });

  // ----------------------------------------------------------
  // Test 9: No matching Basic Price → UNRESOLVED
  // ----------------------------------------------------------
  it('9. No matching Basic Price returns UNRESOLVED', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [], // empty
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('NO_BASIC_PRICE_CANDIDATE');
    expect(result.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH');
    expect(result.reasonCodes).toContain('LABOR_DAY_UNIT_EQUIVALENT');
    expect(result.explanation).toContain('tidak ada Basic Price');
  });

  // ----------------------------------------------------------
  // Test 10: Very high nominal price resolves exactly the same way;
  //          no price-based warning produced
  // ----------------------------------------------------------
  it('10. A very high nominal price resolves exactly the same way; no price-based warning', () => {
    const highPrice: BasicPriceCandidate = {
      ...PRICE_PEKERJA_STANDARD,
      id: 'price-high-uuid-999',
      value: '999999999.99',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [highPrice],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.sourcePriceValue).toBe('999999999.99');
    expect(result.adaptedPriceValue).toBe('999999999.99');
    // Explanation must not contain any price-warning language
    expect(result.explanation).not.toMatch(/terlalu tinggi|terlalu mahal|harga tinggi|warning/i);
    expect(result.reasonCodes).toContain('SINGLE_ELIGIBLE_BASIC_PRICE');
  });

  // ----------------------------------------------------------
  // Test 11: Unrelated Basic Prices from another ResourceCatalog are never selected
  // ----------------------------------------------------------
  it('11. Unrelated Basic Prices (Mandor catalog) are never selected when Pekerja resolves', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA, CATALOG_MANDOR],
      // Only Mandor price provided, no Pekerja price
      eligibleBasicPriceCandidates: [PRICE_MANDOR],
    });

    // Catalog candidates: both Pekerja and Mandor have name match only for Pekerja
    // exactCatalogMatches for "Pekerja" / LABOR should only be CATALOG_PEKERJA
    // Then no price has resourceId === CATALOG_PEKERJA.id → UNRESOLVED
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('NO_BASIC_PRICE_CANDIDATE');
    if (result.status === 'UNRESOLVED') {
      expect((result as any).selectedBasicPriceId).toBeUndefined();
    }
  });

  // ----------------------------------------------------------
  // Test 12: Input decimal strings returned exactly without
  //          conversion to JavaScript number
  // ----------------------------------------------------------
  it('12. Input decimal strings returned exactly without JavaScript number conversion', () => {
    // A value that would lose precision as a JS float
    const precisePrice: BasicPriceCandidate = {
      ...PRICE_PEKERJA_STANDARD,
      id: 'price-precise-uuid-001',
      value: '123456789.123456',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [precisePrice],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    // String must be bit-identical to input — not parsed and re-serialized
    expect(result.sourcePriceValue).toBe('123456789.123456');
    expect(result.adaptedPriceValue).toBe('123456789.123456');
  });

  // ----------------------------------------------------------
  // Additional: Orang/Hari catalog unit also resolves with OH
  // ----------------------------------------------------------
  it('Additional: catalog baseUnit "Orang/Hari" also satisfies labor-day equivalence with OH', () => {
    const catalogOrangHari: ResourceCatalogCandidate = {
      ...CATALOG_PEKERJA,
      baseUnit: 'Orang/Hari',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [catalogOrangHari],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.reasonCodes).toContain('LABOR_DAY_UNIT_EQUIVALENT');
  });

  // ----------------------------------------------------------
  // Additional: Catalog unit Org/Hari with ahspUnit Orang/Hari resolves
  // ----------------------------------------------------------
  it('Additional: ahspUnit Orang/Hari with catalog Org/Hari also resolves', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      ahspUnit: 'Orang/Hari',
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.conversionFactor).toBe('1');
  });

  // ----------------------------------------------------------
  // Additional: Reason codes inspected for explanation completeness
  // ----------------------------------------------------------
  it('Additional: explanation must mention catalog ID, price ID, and Indonesian traceability text', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.explanation).toContain(CATALOG_PEKERJA.id);
    expect(result.explanation).toContain(PRICE_PEKERJA_STANDARD.id);
    expect(result.explanation).toContain('SIMPROK menghitung');
  });

  // ----------------------------------------------------------
  // PM-REVISE Test 13: Basic Price unit Jam → BASIC_PRICE_UNIT_NOT_SUPPORTED
  // ----------------------------------------------------------
  it('13 (PM-REVISE). Pekerja/OH + catalog Org/Hari + Basic Price unit Jam → UNRESOLVED / BASIC_PRICE_UNIT_NOT_SUPPORTED', () => {
    const priceJam: BasicPriceCandidate = {
      id: 'price-pekerja-jam-uuid-001',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '15000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Jam',
      unitResolution: { status: 'NEEDS_REVIEW', canonicalUnitCode: null, quantityFactor: null, priceOperation: null },
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceJam],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('BASIC_PRICE_UNIT_NOT_SUPPORTED');
    expect(result.reasonCodes).toContain('EXACT_RESOURCE_NAME_MATCH');
    expect(result.reasonCodes).toContain('LABOR_DAY_UNIT_EQUIVALENT');
    // Must NOT have selectedBasicPriceId
    expect((result as any).selectedBasicPriceId).toBeUndefined();
    expect(result.explanation).toContain('labor-day');
  });

  // ----------------------------------------------------------
  // PM-REVISE Test 14: One compatible (Org/Hari) + one incompatible (Jam) price
  //   → selects the compatible one, not NEEDS_REVIEW
  // ----------------------------------------------------------
  it('14 (PM-REVISE). One Org/Hari price + one Jam price for same resource → RESOLVED with Org/Hari, not NEEDS_REVIEW', () => {
    const priceJam: BasicPriceCandidate = {
      id: 'price-pekerja-jam-uuid-002',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '15000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Jam',
      unitResolution: { status: 'NEEDS_REVIEW', canonicalUnitCode: null, quantityFactor: null, priceOperation: null },
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      // Both prices match by resourceId; only Org/Hari is labor-day-compatible.
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD, priceJam],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    // Must select the compatible Org/Hari price, not the Jam price
    expect(result.selectedBasicPriceId).toBe(PRICE_PEKERJA_STANDARD.id);
    expect(result.sourceUnit).toBe('Org/Hari');
    expect(result.reasonCodes).toContain('SINGLE_ELIGIBLE_BASIC_PRICE');
    // Must NOT be NEEDS_REVIEW because the Jam price was correctly excluded
    expect(result.status).not.toBe('NEEDS_REVIEW');
  });

  // ----------------------------------------------------------
  // PM-REVISE Test 15: Two labor-day-compatible prices → still NEEDS_REVIEW
  // ----------------------------------------------------------
  it('15 (PM-REVISE). Two labor-day-compatible prices for same resource → NEEDS_REVIEW (unchanged)', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      // Both are Org/Hari — both are compatible — kernel cannot select automatically
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD, PRICE_PEKERJA_ALTERNATIVE],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_BASIC_PRICE_CANDIDATES');
    expect(result.explanation).toContain('kompatibel');
  });

  // ----------------------------------------------------------
  // PM-REVISE Test 16: Basic Price unit case and whitespace variations → RESOLVED
  // ----------------------------------------------------------
  it('16 (PM-REVISE). Basic Price unit case and surrounding whitespace variations are accepted as labor-day', () => {
    const priceUpperOH: BasicPriceCandidate = {
      ...PRICE_PEKERJA_STANDARD,
      id: 'price-pekerja-upper-oh-uuid-001',
      unit: '  OH  ',
    };
    const priceOrangHari: BasicPriceCandidate = {
      ...PRICE_PEKERJA_STANDARD,
      id: 'price-pekerja-orang-hari-uuid-001',
      unit: 'orang/hari',
    };

    // Each tested individually to ensure one compatible price → RESOLVED
    const resultOH = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceUpperOH],
    });
    expect(resultOH.status).toBe('RESOLVED');
    if (resultOH.status === 'RESOLVED') {
      expect(resultOH.selectedBasicPriceId).toBe(priceUpperOH.id);
    }

    const resultOrangHari = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceOrangHari],
    });
    expect(resultOrangHari.status).toBe('RESOLVED');
    if (resultOrangHari.status === 'RESOLVED') {
      expect(resultOrangHari.selectedBasicPriceId).toBe(priceOrangHari.id);
    }
  });

  // ----------------------------------------------------------
  // BP-AHSP-PHASE-2 Option C: Freshness-Aware Deterministic Resolution
  // Bounded, additive regression tests. Existing fixtures above remain
  // untouched and continue to carry no freshnessStatus field.
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // TEST 20 (Option C): Missing freshnessStatus preserves Phase 1 behavior
  // ----------------------------------------------------------
  it('20 (Option C). Missing freshnessStatus preserves Phase 1 behavior and remains selectable', () => {
    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [PRICE_PEKERJA_STANDARD],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.selectedBasicPriceId).toBe(PRICE_PEKERJA_STANDARD.id);
    expect(result.sourcePriceValue).toBe(PRICE_PEKERJA_STANDARD.value);
    expect(result.adaptedPriceValue).toBe(PRICE_PEKERJA_STANDARD.value);
    expect(result.reasonCodes).toContain('SINGLE_ELIGIBLE_BASIC_PRICE');
    expect(result.reasonCodes).not.toContain('ONLY_EXPIRED_BASIC_PRICE_CANDIDATES');
  });

  // ----------------------------------------------------------
  // TEST 21 (Option C): Only expired compatible candidates → NEEDS_REVIEW
  // ----------------------------------------------------------
  it('21 (Option C). Only expired compatible Basic Price candidates return NEEDS_REVIEW without selection', () => {
    const priceExpiredA: BasicPriceCandidate = {
      id: 'price-pekerja-expired-uuid-001',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '120000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Org/Hari',
      freshnessStatus: 'EXPIRED',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };
    const priceExpiredB: BasicPriceCandidate = {
      id: 'price-pekerja-expired-uuid-002',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '125000.00',
      sourceOrigin: 'FIELD_REPORT',
      unit: 'Org/Hari',
      freshnessStatus: 'EXPIRED',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceExpiredA, priceExpiredB],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('ONLY_EXPIRED_BASIC_PRICE_CANDIDATES');
    expect(result.reasonCodes).not.toContain('MULTIPLE_BASIC_PRICE_CANDIDATES');
    expect((result as any).selectedBasicPriceId).toBeUndefined();
    expect(result.explanation).toContain('kedaluwarsa');
    expect(result.explanation).toContain('tinjauan manusia');
    expect(result.explanation).not.toMatch(/dipilih otomatis/i);
  });

  // ----------------------------------------------------------
  // TEST 22 (Option C): One CURRENT plus expired candidates → current resolves
  // ----------------------------------------------------------
  it('22 (Option C). One CURRENT compatible candidate plus expired candidates resolves to the current candidate', () => {
    const priceCurrent: BasicPriceCandidate = {
      id: 'price-pekerja-current-uuid-001',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '130000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Org/Hari',
      freshnessStatus: 'CURRENT',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };
    const priceExpired: BasicPriceCandidate = {
      id: 'price-pekerja-expired-uuid-003',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '110000.00',
      sourceOrigin: 'FIELD_REPORT',
      unit: 'Org/Hari',
      freshnessStatus: 'EXPIRED',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceCurrent, priceExpired],
    });

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.selectedBasicPriceId).toBe(priceCurrent.id);
    expect(result.sourcePriceValue).toBe(priceCurrent.value);
    expect(result.adaptedPriceValue).toBe(priceCurrent.value);
    expect(result.reasonCodes).not.toContain('ONLY_EXPIRED_BASIC_PRICE_CANDIDATES');
  });

  // ----------------------------------------------------------
  // TEST 23 (Option C): Multiple active candidates → NEEDS_REVIEW
  // ----------------------------------------------------------
  it('23 (Option C). Multiple active compatible candidates (CURRENT + EXPIRING) return NEEDS_REVIEW without selection', () => {
    const priceCurrent: BasicPriceCandidate = {
      id: 'price-pekerja-current-uuid-002',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '130000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Org/Hari',
      freshnessStatus: 'CURRENT',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };
    const priceExpiring: BasicPriceCandidate = {
      id: 'price-pekerja-expiring-uuid-001',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '128000.00',
      sourceOrigin: 'FIELD_REPORT',
      unit: 'Org/Hari',
      freshnessStatus: 'EXPIRING',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };
    const priceExpired: BasicPriceCandidate = {
      id: 'price-pekerja-expired-uuid-004',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '100000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Org/Hari',
      freshnessStatus: 'EXPIRED',
      unitResolution: VALIDATED_PERSON_DAY_PRICE_UNIT,
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceCurrent, priceExpiring, priceExpired],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_BASIC_PRICE_CANDIDATES');
    expect(result.reasonCodes).not.toContain('ONLY_EXPIRED_BASIC_PRICE_CANDIDATES');
    expect((result as any).selectedBasicPriceId).toBeUndefined();
  });

  // ----------------------------------------------------------
  // TEST 24 (Option C): Expired wrong-unit candidate preserves existing
  // unit-not-supported behavior; must not produce an expired-only result
  // ----------------------------------------------------------
  it('24 (Option C). Expired candidate with unsupported unit preserves existing unit-not-supported outcome', () => {
    const priceExpiredJam: BasicPriceCandidate = {
      id: 'price-pekerja-expired-jam-uuid-001',
      resourceId: 'catalog-pekerja-uuid-001',
      value: '15000.00',
      sourceOrigin: 'GOVERNMENT',
      unit: 'Jam',
      unitResolution: { status: 'NEEDS_REVIEW', canonicalUnitCode: null, quantityFactor: null, priceOperation: null },
      freshnessStatus: 'EXPIRED',
    };

    const result = resolveAhspResourcePrice({
      ...BASE_INPUT,
      resourceCatalogCandidates: [CATALOG_PEKERJA],
      eligibleBasicPriceCandidates: [priceExpiredJam],
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('BASIC_PRICE_UNIT_NOT_SUPPORTED');
    expect(result.reasonCodes).not.toContain('ONLY_EXPIRED_BASIC_PRICE_CANDIDATES');
    expect((result as any).selectedBasicPriceId).toBeUndefined();
  });
});
