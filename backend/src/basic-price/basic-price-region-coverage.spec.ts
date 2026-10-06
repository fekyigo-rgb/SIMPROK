import {
  BasicPriceRegionCoverageError,
  canonicalBasicPriceRegionCoverage,
  type CoverageRegionFact,
} from './basic-price-region-coverage';

const district: CoverageRegionFact = {
  id: 'district-id',
  code: '81.71.02',
  isActive: true,
  administrativeLevel: 'DISTRICT',
  parentId: 'city-id',
};

const village = (id: string, code: string): CoverageRegionFact => ({
  id,
  code,
  isActive: true,
  administrativeLevel: 'VILLAGE',
  parentId: district.id,
});

describe('canonicalBasicPriceRegionCoverage', () => {
  it('is deterministic and order-independent by official Region identity', () => {
    const a = village('a', '81.71.02.1001');
    const b = village('b', '81.71.02.1002');

    const left = canonicalBasicPriceRegionCoverage(district, [a, b]);
    const right = canonicalBasicPriceRegionCoverage(district, [b, a]);

    expect(right).toEqual(left);
    expect(left.memberRegionIds).toEqual(['a', 'b']);
  });

  it('changes identity when explicit membership changes', () => {
    const a = village('a', '81.71.02.1001');
    const b = village('b', '81.71.02.1002');
    const c = village('c', '81.71.02.1003');

    expect(
      canonicalBasicPriceRegionCoverage(district, [a, b])
        .deterministicDigest,
    ).not.toBe(
      canonicalBasicPriceRegionCoverage(district, [a, c])
        .deterministicDigest,
    );
  });

  it.each([
    [
      'duplicate member',
      [village('a', '81.71.02.1001'), village('a', '81.71.02.1001')],
      'REGION_COVERAGE_DUPLICATE_MEMBER',
    ],
    [
      'cross-district member',
      [
        village('a', '81.71.02.1001'),
        { ...village('b', '81.71.03.1001'), parentId: 'other-district' },
      ],
      'REGION_COVERAGE_MEMBER_OUTSIDE_ANCHOR',
    ],
    [
      'non-village member',
      [
        village('a', '81.71.02.1001'),
        {
          ...village('b', '81.71.02.1002'),
          administrativeLevel: 'DISTRICT',
        },
      ],
      'REGION_COVERAGE_MEMBER_MUST_BE_ACTIVE_VILLAGE',
    ],
  ])('rejects %s', (_label, members, code) => {
    expect(() => canonicalBasicPriceRegionCoverage(district, members)).toThrow(
      new BasicPriceRegionCoverageError(
        code as ConstructorParameters<typeof BasicPriceRegionCoverageError>[0],
      ),
    );
  });

  it('refuses zero/one-member sets so scalar regionId remains canonical', () => {
    expect(() =>
      canonicalBasicPriceRegionCoverage(district, [
        village('a', '81.71.02.1001'),
      ]),
    ).toThrow('REGION_COVERAGE_REQUIRES_MULTIPLE_VILLAGES');
  });
});
