import { BadRequestException } from '@nestjs/common';
import { ProjectIntakeReferenceController } from './project-intake-reference.controller';

const COUNTRY='11111111-1111-4111-8111-111111111111';
const PROVINCE='22222222-2222-4222-8222-222222222222';
const CITY='33333333-3333-4333-8333-333333333333';
const NODE={
  [COUNTRY]:{id:COUNTRY,name:'Indonesia test',parentId:null,administrativeLevel:'COUNTRY',isActive:true},
  [PROVINCE]:{id:PROVINCE,name:'Maluku test',parentId:COUNTRY,administrativeLevel:'PROVINCE',isActive:true},
  [CITY]:{id:CITY,name:'Ambon test',parentId:PROVINCE,administrativeLevel:'REGENCY_CITY',isActive:true},
};
function createController(records: Record<string,any>=NODE) {
  const prisma={region:{findUnique:jest.fn(async({where}:{where:{id:string}})=>records[where.id]??null)}};
  const controller=new ProjectIntakeReferenceController({} as any,{} as any,prisma as any);
  return {controller,prisma};
}
describe('Read-only canonical region backflow',()=>{
  it('reuses the existing hierarchy to reconstruct selected city+country without writes',async()=>{
    const {controller,prisma}=createController();
    const result=await controller.selectedRegionLineage(CITY+','+COUNTRY);
    expect(result.nodes.map(x=>x.id).sort()).toEqual([COUNTRY,PROVINCE,CITY].sort());
    expect(prisma.region.findUnique).toHaveBeenCalledTimes(3);
    expect(Object.keys(prisma.region)).toEqual(['findUnique']);
  });
  it('rejects malformed and oversized id lists before reading',async()=>{
    const {controller,prisma}=createController();
    await expect(controller.selectedRegionLineage('bad')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.selectedRegionLineage('')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.selectedRegionLineage(Array.from({length:26},()=>COUNTRY).join(',')))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.region.findUnique).not.toHaveBeenCalled();
  });
  it('rejects inactive or missing selection, rather than silently discarding it',async()=>{
    const inactive=createController({...NODE,[CITY]:{...NODE[CITY],isActive:false}});
    await expect(inactive.controller.selectedRegionLineage(CITY)).rejects.toBeInstanceOf(BadRequestException);
    const missing=createController({[COUNTRY]:NODE[COUNTRY]});
    await expect(missing.controller.selectedRegionLineage(CITY)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects invalid hierarchy, including cycles and skipping a level',async()=>{
    const cycled=createController({...NODE,[COUNTRY]:{...NODE[COUNTRY],parentId:CITY,administrativeLevel:'PROVINCE'}});
    await expect(cycled.controller.selectedRegionLineage(CITY)).rejects.toBeInstanceOf(BadRequestException);
    const skipped=createController({...NODE,[CITY]:{...NODE[CITY],parentId:COUNTRY}});
    await expect(skipped.controller.selectedRegionLineage(CITY)).rejects.toBeInstanceOf(BadRequestException);
  });
});
