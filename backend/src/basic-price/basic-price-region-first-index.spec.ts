import { buildRegionFirstIndex, regionFirstGroupKeys, regionFirstGroupRegionIds, type RegionFirstNode } from './basic-price-region-first-index';

describe('BP-REGION-FIRST — disjoint canonical scope grouping', () => {
  const province = { id:'p',name:'Daerah Khusus Ibukota Jakarta',administrativeLevel:'PROVINCE' };
  const cityS = { id:'cS',name:'Kota Administrasi Jakarta Selatan',administrativeLevel:'REGENCY_CITY',parent:province };
  const cityP = { id:'cP',name:'Kota Administrasi Jakarta Pusat',administrativeLevel:'REGENCY_CITY',parent:province };
  const pancoran = { id:'dPan',name:'Pancoran',administrativeLevel:'DISTRICT',parent:cityS };
  const tebet = { id:'dTeb',name:'Tebet',administrativeLevel:'DISTRICT',parent:cityS };
  const senen = { id:'dSen',name:'Senen',administrativeLevel:'DISTRICT',parent:cityP };
  const legacy = { id:'legacy',name:'Kecamatan Teluk Ambon Baguala, Kota Ambon',administrativeLevel:null };
  const all = [province,cityS,cityP,pancoran,tebet,senen,legacy] as RegionFirstNode[];
  test('233 real-snapshot-like scoped observations: sorted province/cities, legacy isolated, exact total', () => {
    const index = buildRegionFirstIndex([
      {regionId:'dPan',count:71},{regionId:'dTeb',count:42},{regionId:'dSen',count:58},{regionId:'legacy',count:62},
    ],all);
    expect(index.total).toBe(233);
    expect(index.provinces).toHaveLength(1);
    expect(index.provinces[0].priceCount).toBe(171);
    expect(index.provinces[0].cities.map(c=>[c.name,c.priceCount])).toEqual([
      ['Kota Administrasi Jakarta Pusat',58],['Kota Administrasi Jakarta Selatan',113],
    ]);
    expect(index.provinces[0].cities[1].scopeRegionIds).toEqual(['dPan','dTeb']);
    expect(index.unverified.count).toBe(62);
    expect(index.unverified.regions[0].id).toBe('legacy');
    expect(regionFirstGroupKeys(index)).toEqual(['city:cP','city:cS','unverified']);
    expect(index.provinces.reduce((sum,p)=>sum+p.priceCount,0)+index.unverified.count+index.general.count)
      .toBe(index.total);
  });
  test('Province-scope price belongs ONLY to province group and never city descendants', () => {
    const i=buildRegionFirstIndex([{regionId:'p',count:4},{regionId:'cP',count:8},{regionId:'dSen',count:2}],all);
    expect(i.provinces[0].provinceOnly.count).toBe(4);
    expect(regionFirstGroupRegionIds(i,'province:p')).toEqual(['p']);
    expect(regionFirstGroupRegionIds(i,'city:cP')).toEqual(['cP','dSen']);
    expect(regionFirstGroupKeys(i)).toEqual(['province:p','city:cP']);
  });
  test('Village, city and district from one verified chain merge into same city index without duplication', () => {
    const village={id:'v1',name:'Kalibata',administrativeLevel:'VILLAGE',parent:pancoran} satisfies RegionFirstNode;
    const i=buildRegionFirstIndex([{regionId:'v1',count:1},{regionId:'dPan',count:2},{regionId:'cS',count:3}],
      [...all,village]);
    expect(i.provinces[0].cities[0].priceCount).toBe(6);
    expect(i.provinces[0].cities[0].scopeRegionIds).toEqual(['cS','dPan','v1']);
  });
  test('Legacy name is NEVER guessed as a verified city/province', () => {
    const i=buildRegionFirstIndex([{regionId:'legacy',count:62}],all);
    expect(i.provinces).toEqual([]);
    expect(i.unverified.count).toBe(62);
    expect(regionFirstGroupRegionIds(i,'unverified')).toEqual(['legacy']);
  });
  test('Incomplete verified district hierarchy remains unverified, no silent geographical migration', () => {
    const orphan={id:'dOrph',name:'Some district',administrativeLevel:'DISTRICT'} satisfies RegionFirstNode;
    const i=buildRegionFirstIndex([{regionId:'dOrph',count:3}], [...all,orphan]);
    expect(i.provinces).toHaveLength(0);
    expect(i.unverified.regions).toEqual([{id:'dOrph',name:'Some district',count:3}]);
  });
  test('General null scope is isolated; bad key cannot widen eligibility', () => {
    const i=buildRegionFirstIndex([{regionId:null,count:2},{regionId:'dSen',count:1}],all);
    expect(i.general.count).toBe(2);
    expect(regionFirstGroupRegionIds(i,'general')).toBeNull();
    expect(regionFirstGroupRegionIds(i,'city:invalid')).toBeUndefined();
  });
  test('invalid negative count must not be accepted', () => {
    expect(()=>buildRegionFirstIndex([{regionId:'dSen',count:-1}],all)).toThrow('BP_REGION_INDEX_INVALID_COUNT');
  });
});
