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
 */

import {
  resolveAhspResourcePrice,
  AhspResourceResolutionInput,
  ResourceCatalogCandidate,
  BasicPriceCandidate,
} from './ahsp-resource-price-resolution.kernel';

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
};

const PRICE_PEKERJA_ALTERNATIVE: BasicPriceCandidate = {
  id: 'price-pekerja-uuid-002',
  resourceId: 'catalog-pekerja-uuid-001',
  value: '135000.00',
  sourceOrigin: 'MARKET_SURVEY',
  unit: 'Org/Hari',
};

const PRICE_MANDOR: BasicPriceCandidate = {
  id: 'price-mandor-uuid-003',
  resourceId: 'catalog-mandor-uuid-002',
  value: '180000.00',
  sourceOrigin: 'GOVERNMENT',
  unit: 'Org/Hari',
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
});
