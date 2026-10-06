import {
  basicPriceRegionApplicabilityWhere,
  basicPriceRegionMatches,
} from './basic-price-region-applicability';

describe('Basic Price exact Region applicability', () => {
  it('preserves legacy scalar exact matching', () => {
    const scalar = {
      regionId: 'district-a',
      regionCoverageSetId: null,
    };
    expect(basicPriceRegionMatches(scalar, 'district-a')).toBe(true);
    expect(basicPriceRegionMatches(scalar, 'village-a')).toBe(false);
  });

  it('matches only explicit members for multi-coverage', () => {
    const covered = {
      regionId: 'district-a',
      regionCoverageSetId: 'coverage-a',
      regionCoverageSet: {
        members: [{ regionId: 'village-a' }, { regionId: 'village-b' }],
      },
    };
    expect(basicPriceRegionMatches(covered, 'village-a')).toBe(true);
    expect(basicPriceRegionMatches(covered, 'village-b')).toBe(true);
    expect(basicPriceRegionMatches(covered, 'village-c')).toBe(false);
    expect(basicPriceRegionMatches(covered, 'district-a')).toBe(false);
    expect(basicPriceRegionMatches(covered, 'district-b')).toBe(false);
  });

  it('builds the same fail-closed law for database consumers', () => {
    expect(basicPriceRegionApplicabilityWhere('village-a')).toEqual({
      OR: [
        { regionCoverageSetId: null, regionId: 'village-a' },
        {
          regionCoverageSetId: { not: null },
          regionCoverageSet: {
            is: { members: { some: { regionId: 'village-a' } } },
          },
        },
      ],
    });
  });
});
