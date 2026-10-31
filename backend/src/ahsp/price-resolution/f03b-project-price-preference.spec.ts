import { resolveAhspResourcePrice, type AhspResourceResolutionInput } from './ahsp-resource-price-resolution.kernel';

const catalog = {
  id: 'catalog-semen-proven', code: 'CEM-001', name: 'Semen',
  type: 'MATERIAL' as const, baseUnit: 'kg',
};
const unit = {
  status: 'RESOLVED' as const, canonicalUnitCode: 'MASS_KG',
  quantityFactor: '1', priceOperation: 'IDENTITY' as const,
  rawSourceUnit: 'kg', rawTargetUnit: 'kg',
};
const price = (id: string, value: string, freshnessStatus: 'CURRENT' | 'EXPIRED' = 'CURRENT') => ({
  id, value, freshnessStatus, resourceId: catalog.id,
  sourceOrigin: id === 'a' ? 'GOVERNMENT' : 'FIELD_REPORT',
  unit: 'kg', unitResolution: unit,
});
const first = price('a', '70000.00');
const second = price('b', '75000.00');
const third = price('c', '80000.00');
const input = (mode?: 'LOWEST' | 'MIDDLE' | 'HIGHEST' | null, offers = [third, first, second]): AhspResourceResolutionInput => ({
  projectId: 'project-01', ahspVersionId: 'ahsp-01',
  ahspResourceId: 'row-01', rawResourceRef: 'Semen',
  resourceType: 'MATERIAL', ahspUnit: 'kg',
  resourceCatalogCandidates: [catalog],
  eligibleBasicPriceCandidates: offers,
  priceSelectionPreferenceMode: mode,
  validatedUnitResolution: {
    status: 'RESOLVED', canonicalUnitCode: 'MASS_KG',
    quantityFactor: '1', rawSourceUnit: 'kg', rawTargetUnit: 'kg',
  },
  resolvedIdentity: { catalog, identityReason: 'RESOURCE_CATALOG_ID_ACTIVE_AND_SCOPED' },
});

describe('F03B Project-owned preference in the EXISTING AHSP price authority', () => {
  it('without a saved preference, retains Phase-1 multiple-price NEEDS_REVIEW', () => {
    const result = resolveAhspResourcePrice(input());
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTIPLE_BASIC_PRICE_CANDIDATES');
  });
  it.each([
    ['LOWEST', 'a', '70000.00'],
    ['MIDDLE', 'b', '75000.00'],
    ['HIGHEST', 'c', '80000.00'],
  ] as const)('%s chooses existing canonical BasicPrice ID, never manufactures money', (mode, id, value) => {
    const result = resolveAhspResourcePrice(input(mode));
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.selectedBasicPriceId).toBe(id);
    expect(result.sourcePriceValue).toBe(value);
    expect(result.adaptedPriceValue).toBe(value);
    expect(result.reasonCodes).toContain('PROJECT_PRICE_PREFERENCE_' + mode);
    expect(result.reasonCodes).not.toContain('SINGLE_ELIGIBLE_BASIC_PRICE');
  });
  it('is independent of candidate input order', () => {
    for (const offers of [[first, second, third], [second, third, first], [third, first, second]]) {
      const result = resolveAhspResourcePrice(input('MIDDLE', offers));
      expect(result.status).toBe('RESOLVED');
      if (result.status === 'RESOLVED') expect(result.selectedBasicPriceId).toBe('b');
    }
  });
  it('even-number MIDDLE never invents arithmetic median or arbitrary middle offer', () => {
    const result = resolveAhspResourcePrice(input('MIDDLE', [first, third]));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTI_PRICE_MIDDLE_EVEN_UNRESOLVED');
  });
  it.each(['LOWEST', 'MIDDLE', 'HIGHEST'] as const)('%s refuses tied source provenance', mode => {
    const offers = [first, price('another', '70000.00'), second];
    const result = resolveAhspResourcePrice(input(mode, offers));
    if (mode === 'LOWEST' || mode === 'MIDDLE') {
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.reasonCodes).toContain('MULTI_PRICE_TIE_UNRESOLVED');
    } else {
      expect(result.status).toBe('RESOLVED');
    }
  });
  it('MIDDLE tie with adjacent source refuses arbitrary selection', () => {
    const result = resolveAhspResourcePrice(input('MIDDLE', [first, second, price('other', '75000.00')]));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTI_PRICE_TIE_UNRESOLVED');
  });
  it('HIGHEST tie refuses arbitrary selection', () => {
    const result = resolveAhspResourcePrice(input('HIGHEST', [first, third, price('other', '80000.00')]));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTI_PRICE_TIE_UNRESOLVED');
  });
  it('cannot rank if any otherwise compatible offer is expired', () => {
    const result = resolveAhspResourcePrice(input('LOWEST', [first, price('expired', '1000.00', 'EXPIRED')]));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTI_PRICE_COMPARABILITY_UNPROVEN');
  });
  it.each(['-100.00', '900.123', 'Infinity', '1e9'] as const)('cannot rank invalid money %s', bad => {
    const result = resolveAhspResourcePrice(input('LOWEST', [first, price('bad', bad)]));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reasonCodes).toContain('MULTI_PRICE_COMPARABILITY_UNPROVEN');
  });
  it('unrelated resource ID cannot become cheaper or win', () => {
    const foreign = { ...price('foreign', '1.00'), resourceId: 'another-catalog' };
    const result = resolveAhspResourcePrice(input('LOWEST', [third, first, foreign]));
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') expect(result.selectedBasicPriceId).toBe('a');
  });
  it('unproven unit of an otherwise cheap offer cannot win', () => {
    const bad = { ...price('bad-unit', '1.00'), unitResolution: {
      ...unit, status: 'NEEDS_REVIEW' as const,
    } };
    const result = resolveAhspResourcePrice(input('LOWEST', [third, first, bad]));
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') expect(result.selectedBasicPriceId).toBe('a');
  });
  it('single eligible price keeps historical reason and exact money even with intent', () => {
    const result = resolveAhspResourcePrice(input('HIGHEST', [first]));
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.selectedBasicPriceId).toBe('a');
    expect(result.reasonCodes).toContain('SINGLE_ELIGIBLE_BASIC_PRICE');
    expect(result.reasonCodes.some(x => x.startsWith('PROJECT_PRICE_PREFERENCE_'))).toBe(false);
  });
});
