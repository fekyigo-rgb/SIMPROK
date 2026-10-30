import {
  firstEligiblePriceRegionTier,
  projectPriceRegionLadder,
  type PriceRegionFact,
} from './basic-price-region-priority';

const region = (
  id: string, level: string, parentId: string | null, isActive = true,
): PriceRegionFact => ({ id, administrativeLevel: level, parentId, isActive });

const hierarchy = [
  region('province-jakarta', 'PROVINCE', null),
  region('city-jakarta-pusat', 'REGENCY_CITY', 'province-jakarta'),
  region('district-gambir', 'DISTRICT', 'city-jakarta-pusat'),
  region('village-gambir', 'VILLAGE', 'district-gambir'),
  region('city-jakarta-selatan', 'REGENCY_CITY', 'province-jakarta'),
  region('district-pancoran', 'DISTRICT', 'city-jakarta-selatan'),
  region('village-pancoran', 'VILLAGE', 'district-pancoran'),
] as const;

type Offer = Readonly<{ id: string; appliesTo: string }>;
const offer = (id: string, appliesTo: string): Offer => ({ id, appliesTo });
const eligibleAt = (candidate: Offer, regionId: string) => candidate.appliesTo === regionId;

describe('RAB-36B canonical nearest-region priority', () => {
  it('walks village -> district -> city -> province, using real parent references', () => {
    expect(projectPriceRegionLadder('village-gambir', hierarchy)).toEqual({
      status: 'COMPLETE',
      tiers: [
        { regionId: 'village-gambir', level: 'VILLAGE', priority: 0 },
        { regionId: 'district-gambir', level: 'DISTRICT', priority: 1 },
        { regionId: 'city-jakarta-pusat', level: 'REGENCY_CITY', priority: 2 },
        { regionId: 'province-jakarta', level: 'PROVINCE', priority: 3 },
      ],
    });
  });
  it('stops city-authorised location at city, then province; never descends into villages', () => {
    const ladder = projectPriceRegionLadder('city-jakarta-pusat', hierarchy);
    expect(ladder).toEqual({
      status: 'COMPLETE',
      tiers: [
        { regionId: 'city-jakarta-pusat', level: 'REGENCY_CITY', priority: 0 },
        { regionId: 'province-jakarta', level: 'PROVINCE', priority: 1 },
      ],
    });
    expect(firstEligiblePriceRegionTier(
      ladder,
      [offer('pancoran-price', 'district-pancoran')],
      eligibleAt,
    )).toEqual({ kind: 'NOT_FOUND' });
  });
  it('uses village first when both village and district contain valid eligible offers', () => {
    const ladder = projectPriceRegionLadder('village-gambir', hierarchy);
    expect(firstEligiblePriceRegionTier(
      ladder, [
        offer('district', 'district-gambir'),
        offer('province', 'province-jakarta'),
        offer('village', 'village-gambir'),
      ], eligibleAt,
    )).toMatchObject({ kind: 'FOUND', tier: { level: 'VILLAGE' },
      candidates: [{ id: 'village', appliesTo: 'village-gambir' }] });
  });
  it('falls back to district when village has no eligible offer', () => {
    const ladder = projectPriceRegionLadder('village-gambir', hierarchy);
    expect(firstEligiblePriceRegionTier(ladder,
      [offer('district', 'district-gambir'), offer('province', 'province-jakarta')],
      eligibleAt)).toMatchObject({ kind: 'FOUND', tier: { level: 'DISTRICT' } });
  });
  it('falls back to city and then province only when nearer tiers are empty', () => {
    const ladder = projectPriceRegionLadder('village-gambir', hierarchy);
    expect(firstEligiblePriceRegionTier(ladder,
      [offer('city', 'city-jakarta-pusat'), offer('province', 'province-jakarta')],
      eligibleAt)).toMatchObject({ kind: 'FOUND', tier: { level: 'REGENCY_CITY' } });
    expect(firstEligiblePriceRegionTier(ladder,
      [offer('province', 'province-jakarta')], eligibleAt)).toMatchObject({
        kind: 'FOUND', tier: { level: 'PROVINCE' },
      });
  });
  it('never leaks a similarly-named neighboring village or district', () => {
    const ladder = projectPriceRegionLadder('village-gambir', hierarchy);
    expect(firstEligiblePriceRegionTier(ladder,
      [offer('same-name-other-branch', 'village-pancoran'),
       offer('other-district', 'district-pancoran')], eligibleAt
    )).toEqual({ kind: 'NOT_FOUND' });
  });
  it('returns every same-tier offer and never invents a lowest/cheapest winner', () => {
    const ladder = projectPriceRegionLadder('village-gambir', hierarchy);
    const result = firstEligiblePriceRegionTier(ladder,
      [offer('a', 'district-gambir'), offer('b', 'district-gambir'),
       offer('c', 'province-jakarta')], eligibleAt);
    expect(result).toMatchObject({ kind: 'FOUND', tier: { level: 'DISTRICT' },
      candidates: [{ id: 'a' }, { id: 'b' }] });
  });
  it('fails closed when an ancestor is missing, not marking search exhausted', () => {
    const ladder = projectPriceRegionLadder('village-gambir', [
      region('village-gambir', 'VILLAGE', 'district-unavailable'),
    ]);
    expect(firstEligiblePriceRegionTier(ladder, [], eligibleAt))
      .toEqual({ kind: 'HIERARCHY_INCOMPLETE', reason: 'PARENT_NOT_PROVEN' });
  });
  it('refuses a wrong-level link and an inactive ancestor', () => {
    expect(projectPriceRegionLadder('village-gambir', [
      region('village-gambir', 'VILLAGE', 'province-jakarta'),
      region('province-jakarta', 'PROVINCE', null),
    ])).toMatchObject({ status: 'INCOMPLETE', reason: 'HIERARCHY_LEVEL_MISMATCH' });
    expect(projectPriceRegionLadder('village-gambir', [
      region('village-gambir', 'VILLAGE', 'district-gambir'),
      region('district-gambir', 'DISTRICT', 'city-jakarta-pusat', false),
    ])).toMatchObject({ status: 'INCOMPLETE', reason: 'REGION_INACTIVE' });
  });
});
