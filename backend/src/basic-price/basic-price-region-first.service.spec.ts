import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceEligibilityPolicy } from './basic-price-eligibility.policy';
import { GetBasicPricesDto } from './dto/get-basic-prices.dto';

describe('BP-REGION-FIRST server index: reuse canonical eligibility and page only selected scope', () => {
  const p='10000000-0000-4000-8000-000000000001';
  const a='20000000-0000-4000-8000-000000000001';
  const b='20000000-0000-4000-8000-000000000002';
  const d='30000000-0000-4000-8000-000000000001';
  const legacy='40000000-0000-4000-8000-000000000001';
  const province={id:p,name:'Daerah Khusus Ibukota Jakarta',administrativeLevel:'PROVINCE'};
  const cityA={id:a,name:'Kota Jakarta Pusat',administrativeLevel:'REGENCY_CITY',parent:province};
  const cityB={id:b,name:'Kota Jakarta Selatan',administrativeLevel:'REGENCY_CITY',parent:province};
  const district={id:d,name:'Senen',administrativeLevel:'DISTRICT',parent:cityA};
  const unsupported={id:legacy,name:'Teluk Ambon Baguala, Kota Ambon',administrativeLevel:null};
  const db={
    $queryRaw:jest.fn().mockResolvedValue([]),
    basicPrice:{
      groupBy:jest.fn(),count:jest.fn(),findMany:jest.fn(),
    },
    region:{findMany:jest.fn()},
  };
  const svc=new BasicPriceService(db as never,new BasicPriceEligibilityPolicy());
  beforeEach(()=>{
    jest.clearAllMocks();
    db.$queryRaw.mockResolvedValue([]);
    db.basicPrice.count.mockResolvedValue(7);
    db.basicPrice.findMany.mockResolvedValue([]);
    db.basicPrice.groupBy.mockResolvedValue([
      {regionId:d,_count:{_all:4}},{regionId:b,_count:{_all:2}},
      {regionId:legacy,_count:{_all:1}},
    ]);
    db.region.findMany.mockResolvedValue([district,cityB,unsupported]);
  });
  test('opt-in first group picks alphabetical city from full eligible grouping',async()=>{
    const out=await svc.findAllForWorkspace('50000000-0000-4000-8000-000000000001',{
      regionBrowse:'true',regionGroup:'first',sortBy:'resourceName',sortOrder:'asc',page:2,limit:50,
    });
    expect(out.regionIndex?.total).toBe(7);
    expect(out.regionIndex?.provinces[0].priceCount).toBe(6);
    expect(out.regionIndex?.unverified.count).toBe(1);
    expect(out.selectedRegionGroup).toBe('city:'+a);
    expect(out.regionIndex?.provinces[0].cities.map(c=>c.regionId)).toEqual([a,b]);
    expect(db.basicPrice.groupBy.mock.calls[0][0].where).not.toEqual(
      db.basicPrice.count.mock.calls[0][0].where,
    );
    const listWhere=db.basicPrice.findMany.mock.calls[0][0].where;
    expect(listWhere.AND).toContainEqual({regionId:{in:[d]}});
    expect(db.basicPrice.count.mock.calls[0][0].where).toEqual(listWhere);
    expect(db.basicPrice.findMany.mock.calls[0][0].orderBy).toEqual([
      {resource:{name:'asc'}},{id:'asc'},
    ]);
    expect(db.basicPrice.findMany.mock.calls[0][0].take).toBe(50);
    expect(db.basicPrice.findMany.mock.calls[0][0].skip).toBe(50);
    expect(db.basicPrice.groupBy).toHaveBeenCalledTimes(1);
    expect(db.region.findMany).toHaveBeenCalledTimes(1);
  });
  test('unverified group does not assign unknown legacy region to a city',async()=>{
    const out=await svc.findAllForWorkspace('50000000-0000-4000-8000-000000000001',{
      regionBrowse:'true',regionGroup:'unverified',
    });
    expect(out.selectedRegionGroup).toBe('unverified');
    expect(db.basicPrice.findMany.mock.calls[0][0].where.AND).toContainEqual({
      regionId:{in:[legacy]},
    });
  });
  test('unknown/forged group is a 400 not a widened list',async()=>{
    await expect(svc.findAllForWorkspace('50000000-0000-4000-8000-000000000001',{
      regionBrowse:'true',regionGroup:'city:99999999-9999-4999-8999-999999999999',
    })).rejects.toThrow(BadRequestException);
    expect(db.basicPrice.findMany).not.toHaveBeenCalled();
  });
  test('legacy list behavior unchanged when opt-in is absent',async()=>{
    await svc.findAllForWorkspace('50000000-0000-4000-8000-000000000001',{
      sortBy:'resourceName',sortOrder:'asc',limit:50,
    });
    expect(db.basicPrice.groupBy).not.toHaveBeenCalled();
    expect(db.region.findMany).not.toHaveBeenCalled();
    expect(db.basicPrice.findMany.mock.calls[0][0].orderBy).toEqual([
      {resource:{name:'asc'}},{id:'asc'},
    ]);
  });
  test('DTO rejects unknown switch and malformed group identity',async()=>{
    const invalid=Object.assign(new GetBasicPricesDto(),{
      regionBrowse:'false',regionGroup:'city:garbage',
    });
    const errors=await validate(invalid);
    expect(errors.map(e=>e.property)).toEqual(expect.arrayContaining(['regionBrowse','regionGroup']));
    expect(await validate(Object.assign(new GetBasicPricesDto(),{
      regionBrowse:'true',regionGroup:'city:20000000-0000-4000-8000-000000000001',
    }))).toEqual([]);
  });
});
