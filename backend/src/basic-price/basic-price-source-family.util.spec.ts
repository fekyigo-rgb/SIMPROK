import {
  sourceOriginsForFamily,
  SOURCE_FAMILIES,
} from './basic-price-source-family.util';

describe('basic-price-source-family.util', () => {
  it('GOVERNMENT maps to exactly [GOVERNMENT]', () => {
    expect(sourceOriginsForFamily('GOVERNMENT')).toEqual(['GOVERNMENT']);
  });

  it('STORE_SUPPLIER maps to exactly [SUPPLIER, STORE, DISTRIBUTOR]', () => {
    expect(sourceOriginsForFamily('STORE_SUPPLIER')).toEqual([
      'SUPPLIER',
      'STORE',
      'DISTRIBUTOR',
    ]);
  });

  it('FIELD_PRICE maps to exactly [FIELD_REPORT, COMMUNITY_REPORT]', () => {
    expect(sourceOriginsForFamily('FIELD_PRICE')).toEqual([
      'FIELD_REPORT',
      'COMMUNITY_REPORT',
    ]);
  });

  it('SOURCE_FAMILIES is exactly the three owner-locked families, in order', () => {
    expect(SOURCE_FAMILIES).toEqual([
      'GOVERNMENT',
      'STORE_SUPPLIER',
      'FIELD_PRICE',
    ]);
  });

  it('every PriceSourceOrigin enum value is covered by exactly one family (no gaps, no overlap)', () => {
    const allMapped = SOURCE_FAMILIES.flatMap((family) =>
      sourceOriginsForFamily(family),
    );
    expect(allMapped.sort()).toEqual(
      [
        'GOVERNMENT',
        'SUPPLIER',
        'STORE',
        'DISTRIBUTOR',
        'FIELD_REPORT',
        'COMMUNITY_REPORT',
      ].sort(),
    );
    expect(new Set(allMapped).size).toBe(allMapped.length);
  });
});
