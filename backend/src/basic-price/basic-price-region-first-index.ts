/**
 * BP-REGION-FIRST: presentation-only index over canonical, eligibility-filtered
 * BasicPrice counts. Groups are computed from verified Region parent relations;
 * Region display text is NEVER parsed to invent missing administrative ancestry.
 *
 * One priced Region ID belongs to exactly one bucket. Counts are price
 * observations, not distinct resources, cities, or alleged source averages.
 */
export interface RegionFirstNode {
  id: string;
  name: string;
  administrativeLevel: string | null;
  parent?: RegionFirstNode | null;
}
export interface PricedRegionCount {
  regionId: string | null;
  count: number;
}
export interface RegionFirstCity {
  key: string;
  regionId: string;
  name: string;
  priceCount: number;
  scopeRegionIds: string[];
}
export interface RegionFirstProvince {
  id: string;
  name: string;
  priceCount: number;
  provinceOnly: { key: string; count: number; scopeRegionIds: string[] };
  cities: RegionFirstCity[];
}
export interface RegionFirstIndex {
  /** Sum of all disjoint buckets; counts only rows admitted by the existing BP predicate. */
  total: number;
  provinces: RegionFirstProvince[];
  unverified: {
    key: 'unverified';
    count: number;
    regions: Array<{ id: string; name: string; count: number }>;
    scopeRegionIds: string[];
  };
  general: { key: 'general'; count: number };
}
export const regionFirstGroupKeys = (index: RegionFirstIndex): string[] => [
  ...index.provinces.flatMap((p) => [
    ...(p.provinceOnly.count ? [p.provinceOnly.key] : []),
    ...p.cities.map((c) => c.key),
  ]),
  ...(index.unverified.count ? [index.unverified.key] : []),
  ...(index.general.count ? [index.general.key] : []),
];
export const regionFirstGroupRegionIds = (
  index: RegionFirstIndex, key: string,
): string[] | null | undefined => {
  if (key === 'general') return index.general.count ? null : undefined;
  if (key === 'unverified') return index.unverified.count ? index.unverified.scopeRegionIds : undefined;
  for (const p of index.provinces) {
    if (p.provinceOnly.key === key && p.provinceOnly.count) return p.provinceOnly.scopeRegionIds;
    const city = p.cities.find((c) => c.key === key);
    if (city) return city.scopeRegionIds;
  }
  return undefined;
};
const compareName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** Only the verified full chain can assign a scoped price into a Province/City. */
function canonicalGroup(region: RegionFirstNode):
  | { kind: 'province'; province: RegionFirstNode }
  | { kind: 'city'; province: RegionFirstNode; city: RegionFirstNode }
  | null {
  const level = region.administrativeLevel;
  if (level === 'PROVINCE') return { kind: 'province', province: region };
  if (level === 'REGENCY_CITY') {
    const province = region.parent;
    if (province?.administrativeLevel !== 'PROVINCE') return null;
    return { kind: 'city', province, city: region };
  }
  if (level === 'DISTRICT') {
    const city = region.parent;
    const province = city?.parent;
    if (city?.administrativeLevel !== 'REGENCY_CITY' || province?.administrativeLevel !== 'PROVINCE') return null;
    return { kind: 'city', province, city };
  }
  if (level === 'VILLAGE') {
    const district = region.parent;
    const city = district?.parent;
    const province = city?.parent;
    if (district?.administrativeLevel !== 'DISTRICT' ||
        city?.administrativeLevel !== 'REGENCY_CITY' ||
        province?.administrativeLevel !== 'PROVINCE') return null;
    return { kind: 'city', province, city };
  }
  return null;
}
export function buildRegionFirstIndex(
  pricedRegions: readonly PricedRegionCount[],
  regions: readonly RegionFirstNode[],
): RegionFirstIndex {
  const lookup = new Map(regions.map((r) => [r.id, r]));
  const provinces = new Map<string, RegionFirstProvince>();
  const unknown = new Map<string, { id: string; name: string; count: number }>();
  let generalCount = 0;
  for (const entry of pricedRegions) {
    if (!Number.isSafeInteger(entry.count) || entry.count < 0) {
      throw new Error('BP_REGION_INDEX_INVALID_COUNT');
    }
    if (!entry.count) continue;
    if (entry.regionId === null) {
      generalCount += entry.count;
      continue;
    }
    const region = lookup.get(entry.regionId);
    const group = region && canonicalGroup(region);
    if (!group) {
      const old = unknown.get(entry.regionId);
      unknown.set(entry.regionId, {
        id: entry.regionId,
        name: region?.name ?? 'Wilayah tidak ditemukan',
        count: (old?.count ?? 0) + entry.count,
      });
      continue;
    }
    let province = provinces.get(group.province.id);
    if (!province) {
      province = {
        id: group.province.id,
        name: group.province.name,
        priceCount: 0,
        provinceOnly: { key: 'province:' + group.province.id, count: 0, scopeRegionIds: [] },
        cities: [],
      };
      provinces.set(group.province.id, province);
    }
    province.priceCount += entry.count;
    if (group.kind === 'province') {
      province.provinceOnly.count += entry.count;
      if (!province.provinceOnly.scopeRegionIds.includes(entry.regionId)) {
        province.provinceOnly.scopeRegionIds.push(entry.regionId);
      }
    } else {
      let city = province.cities.find((c) => c.regionId === group.city.id);
      if (!city) {
        city = {
          key: 'city:' + group.city.id,
          regionId: group.city.id,
          name: group.city.name,
          priceCount: 0,
          scopeRegionIds: [],
        };
        province.cities.push(city);
      }
      city.priceCount += entry.count;
      if (!city.scopeRegionIds.includes(entry.regionId)) {
        city.scopeRegionIds.push(entry.regionId);
      }
    }
  }
  const sortedProvinces = [...provinces.values()].sort(compareName);
  for (const province of sortedProvinces) {
    province.cities.sort((a, b) => compareName({ ...a, id: a.regionId }, { ...b, id: b.regionId }));
    province.provinceOnly.scopeRegionIds.sort();
    for (const city of province.cities) city.scopeRegionIds.sort();
  }
  const unverifiedRegions = [...unknown.values()].sort(compareName);
  return {
    total: pricedRegions.reduce((sum, record) => sum + record.count, 0),
    provinces: sortedProvinces,
    unverified: {
      key: 'unverified',
      count: unverifiedRegions.reduce((sum, group) => sum + group.count, 0),
      regions: unverifiedRegions,
      scopeRegionIds: unverifiedRegions.map((group) => group.id).sort(),
    },
    general: { key: 'general', count: generalCount },
  };
}
