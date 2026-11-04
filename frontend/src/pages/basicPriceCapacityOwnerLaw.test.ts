import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readCapacitySpecification, writeCapacitySpecification, nextUnusedCapacityRow,
  specificationFormDecision, specificationInitialFields, SPEC_DIMENSION_FIELDS, SPEC_CAPACITY_TYPES,
  SPEC_CAPACITY_ALL_UNITS,
} from '../utils/basicPriceSpecificationForm.ts';

test('Dump Truck: volume bak and daya angkut are separate capacity facts, berat remains a distinct physical measure',()=>{
  const rows=[
    {kind:'Kapasitas bak',value:'5,2',unit:'m³'},
    {kind:'Daya angkut',value:'5',unit:'ton'},
  ];
  const encoded=writeCapacitySpecification(rows,[]);
  assert.deepEqual(encoded,{text:'Kapasitas bak: 5,2 m³; Daya angkut: 5 ton'});
  assert.deepEqual(readCapacitySpecification(encoded.text),{rows,legacy:[]});
  const decision=specificationFormDecision({
    berat:'5 ton', kapasitas:encoded.text,
  },[],null,'SUPPLEMENT','');
  assert.equal(decision.ok,true);
  if(decision.ok){
    assert.equal(decision.confirmedSpecifications.berat,'5 ton');
    assert.equal(decision.confirmedSpecifications.kapasitas,encoded.text);
    assert.notEqual(decision.confirmedSpecifications.berat,'Daya angkut: 5 ton');
  }
  assert(!SPEC_DIMENSION_FIELDS.some(f=>f.key==='kapasitas'));
});
test('capacity is repeatable: machine displacement, production, engine power; unit tied to type',()=>{
  const rows=[
    {kind:'Kapasitas mesin',value:'4000',unit:'cc'},
    {kind:'Kapasitas produksi',value:'25',unit:'m³/jam'},
    {kind:'Daya mesin',value:'120',unit:'HP'},
  ];
  const serialized=writeCapacitySpecification(rows,[]);
  assert.equal(serialized.error,undefined);
  assert.deepEqual(readCapacitySpecification(serialized.text).rows,rows);
  assert.match(serialized.text,/Kapasitas produksi: 25 m³\/jam/u);
  assert.match(writeCapacitySpecification([
    {kind:'Kapasitas bak',value:'5,2',unit:'ton'},
  ],[]).error??'',/Satuan harus sesuai/u);
});
test('Format A owner extension reuses ONE specification decision for bucket and machine dynamics',()=>{
  const typed=[
    {kind:'Kapasitas bucket',value:'0,8',unit:'m³'},
    {kind:'Kecepatan',value:'12',unit:'km/jam'},
    {kind:'Putaran mesin',value:'1800',unit:'rpm'},
    {kind:'Frekuensi tumbukan',value:'650',unit:'tumbukan/menit'},
    {kind:'Percepatan',value:'9,8',unit:'m/s²'},
    {kind:'Daya mesin',value:'120',unit:'HP'},
  ];
  const encoded=writeCapacitySpecification(typed,[]);
  assert.equal(encoded.error,undefined);
  assert.deepEqual(readCapacitySpecification(encoded.text),{rows:typed,legacy:[]});
  const reviewed=specificationFormDecision({kapasitas:encoded.text},[],null,'SUPPLEMENT','');
  assert.equal(reviewed.ok,true);
  if(reviewed.ok) assert.equal(reviewed.confirmedSpecifications.kapasitas,encoded.text);
  assert.equal(SPEC_CAPACITY_TYPES.find(v=>v.kind==='Kapasitas bucket')?.group,'CAPACITY');
  assert.deepEqual(SPEC_CAPACITY_TYPES.find(v=>v.kind==='Kecepatan')?.units,
    ['m/s','m/menit','m/jam','km/jam']);
  assert.deepEqual(SPEC_CAPACITY_TYPES.find(v=>v.kind==='Kapasitas bak')?.units,['m³','liter']);
  const editor=readFileSync('src/components/basic-price/BasicPriceSpecificationEditor.tsx','utf8');
  assert.match(editor,/SPEC_CAPACITY_GROUPS.map/u);
  assert.match(editor,/Kapasitas \(opsional\)/u);
  assert.match(readFileSync('src/utils/basicPriceSpecificationForm.ts','utf8'),/Dinamika dan Performa Mesin/u);
  assert.doesNotMatch(editor,/new UnitKernel|new CapacityEngine/u);
});
test('speed variants / machine measurements round-trip without implicit conversion',()=>{
  const variants=[
    ['Kecepatan','5','m/s'],['Kecepatan','300','m/menit'],
    ['Kecepatan','18000','m/jam'],['Kecepatan','18','km/jam'],
    ['Frekuensi getaran','55','Hz'],['Periode siklus','8','ms'],
    ['Energi tumbukan','72','J'],['Tekanan','12','MPa'],
    ['Arus listrik','3','A'],['Tegangan listrik','230','V'],
    ['Frekuensi tumbukan','22','pukulan/menit'],
  ] as const;
  for(const [kind,value,unit] of variants){
    const out=writeCapacitySpecification([{kind,value,unit}],[]);
    assert.equal(out.error,undefined,kind+':'+unit);
    assert.deepEqual(readCapacitySpecification(out.text).rows,[{kind,value,unit}]);
  }
  for(const [kind,unit] of [
    ['Kapasitas bucket','ton'], ['Daya angkut','m³'],
    ['Kecepatan','Hz'], ['Frekuensi tumbukan','km/jam'],
    ['Percepatan','m/s'],['Daya mesin','J'],['Tekanan','kW'],
    ['Energi tumbukan','Hz'],['Arus listrik','V']
  ]){
    assert.match(writeCapacitySpecification([{kind,value:'3',unit}],[]).error??'',
      /Satuan harus sesuai/u,kind+':'+unit);
  }
});
test('editor vocabulary and existing server readback contract remain synchronized',()=>{
  const server=readFileSync('../backend/src/basic-price/basic-price-reviewed-capacity.projection.ts','utf8');
  for(const type of SPEC_CAPACITY_TYPES){
    const literal="'"+type.kind+"': ["+type.units.map(unit=>"'"+unit+"'").join(', ')+"]";
    assert(server.includes(literal),'Missing equivalent backend rule: '+type.kind);
  }
  for(const unit of SPEC_CAPACITY_ALL_UNITS)
    assert(server.includes("'"+unit+"'"),'Missing server unit: '+unit);
});
test('source volume and weight are not silently converted into bucket capacity',()=>{
  const fields=specificationInitialFields([
    {label:'volume',value:'6,93 M3'},{label:'Berat',value:'10 Ton'},
  ],null);
  assert.equal(fields.volume,'6,93 M3');
  assert.equal(fields.berat,'10 Ton');
  assert.equal(fields.kapasitas,undefined);
});
test('unknown legacy capacity is never discarded while adding new, approved typed capacity',()=>{
  const initial=readCapacitySpecification('Dump Truck kapasitas standar 7m3');
  assert.deepEqual(initial,{rows:[],legacy:['Dump Truck kapasitas standar 7m3']});
  const out=writeCapacitySpecification([
    {kind:'Kapasitas bak',value:'5,2',unit:'m³'},
  ],initial.legacy);
  assert.equal(out.error,undefined);
  assert.match(out.text,/^Dump Truck kapasitas standar 7m3;/u);
  assert.deepEqual(readCapacitySpecification(out.text).rows,[
    {kind:'Kapasitas bak',value:'5,2',unit:'m³'},
  ]);
  assert.deepEqual(readCapacitySpecification(out.text).legacy,
    ['Dump Truck kapasitas standar 7m3']);
});
test('GATE 1: add capacity reuses an unused kind, never fabricates a duplicate or erases existing rows',()=>{
  const initial=[{kind:'Daya angkut',value:'35',unit:'ton'},
    {kind:'Daya mesin',value:'',unit:'kW'},
    {kind:'Kapasitas bak',value:'',unit:'m³'}];
  const next=nextUnusedCapacityRow(initial);
  assert.deepEqual(next,{kind:'Kapasitas mesin',value:'',unit:'cc'});
  assert.deepEqual(initial[0],{kind:'Daya angkut',value:'35',unit:'ton'});
  const allPresets=SPEC_CAPACITY_TYPES.map(type=>({kind:type.kind,value:'1',unit:type.units[0]}));
  assert.deepEqual(nextUnusedCapacityRow(allPresets),{kind:'',value:'',unit:'m³'});
  const nextRows=[...initial,next];
  assert.equal(new Set(nextRows.map(r=>r.kind)).size,nextRows.length);
  assert.ok(writeCapacitySpecification(nextRows,[]).error,
    'Empty original rows still require review; never silently accept them');
});

test('unverified empty/invalid or duplicate capacity cannot be saved as a verified fact',()=>{
  for(const rows of [
    [{kind:'Kapasitas bak',value:'',unit:'m³'}],
    [{kind:'Kapasitas bak',value:'lima koma dua',unit:'m³'}],
    [{kind:'Kapasitas bak',value:'5,2',unit:'ton'}],
    [{kind:'Kapasitas bak',value:'5,2',unit:'m³'},{kind:'Kapasitas bak',value:'6',unit:'m³'}],
    [{kind:'Kapasitas bak: muatan',value:'6',unit:'m³'}],
  ]){
    assert.ok(writeCapacitySpecification(rows,[]).error,'Expected rejection: '+JSON.stringify(rows));
  }
});
test('GATE 1: reviewed capacity readback reaches the SAME existing editor with honest status',()=>{
  const review=readFileSync('src/pages/BasicPriceReviewPage.tsx','utf8');
  const editor=readFileSync('src/components/basic-price/BasicPriceSpecificationEditor.tsx','utf8');
  const api=readFileSync('src/utils/basicPriceImportDisplay.ts','utf8');
  assert.match(review,/reviewedCapacity=\{row\.reviewedCapacity\}/u);
  assert.match(editor,/reviewedCapacity\?\.status === 'STRUCTURED'/u);
  assert.match(editor,/reviewedCapacity\?\.status === 'UNPARSED'/u);
  assert.match(api,/reviewedCapacity\?:/u);
  assert.doesNotMatch(editor,/createUnitKernel|createResourceIdentity|new CapacityEngine/u);
});

test('universal source header Tipe/Model pre-fills the EXISTING specification editor without guessing identity',()=>{
  const fields=specificationInitialFields([
    {label:'Tipe/Model',value:'Contoh Seri Z-17'},
    {label:'Merk',value:'Contoh Merek Uji'},
    {label:'Spesifikasi Tambahan',value:'Pemasok menyatakan ketahanan UV'},
  ],null);
  assert.equal(fields.tipe,'Contoh Seri Z-17');
  assert.equal(fields.merek,'Contoh Merek Uji');
  assert.equal(fields.spesifikasi,'Pemasok menyatakan ketahanan UV');
});

test('GATE2 Format A supplier descriptions stay verbatim as source-only evidence, not certified mutu/fungsi',()=>{
  const source=[
    {label:'Merk',value:'Conch'},
    {label:'Tipe/Model',value:'PCC'},
    {label:'Berat',value:'40 kg'},
    {label:'Mutu dan Standar',value:'standar'},
    {label:'Jenis/Kegunaan',value:'Semen Portland'},
  ];
  const fields=specificationInitialFields(source,null);
  const result=specificationFormDecision(fields,source,null,'SUPPLEMENT','');
  assert.equal(result.ok,true);
  if(result.ok){
    assert.equal(result.confirmedSpecifications.tipe,'PCC');
    assert.equal(result.confirmedSpecifications.mutu_dan_standar_sumber,'standar');
    assert.equal(result.confirmedSpecifications.jenis_kegunaan_sumber,'Semen Portland');
    assert.equal(result.confirmedSpecifications.mutu,undefined);
    assert.equal(result.confirmedSpecifications.fungsi,undefined);
  }
});
test('Format A screenshot: supplier combined facts are VISIBLE near the editor but not falsely certified',()=>{
  const source=[
    {label:'Merk',value:'Nippon'},
    {label:'Berat',value:'20 kg'},
    {label:'Mutu dan Standar',value:'Kategori Ekonomis'},
    {label:'Jenis/Kegunaan',value:'Cat air'},
  ];
  const fields=specificationInitialFields(source,null);
  assert.equal(fields.merek,'Nippon');
  assert.equal(fields.berat,'20 kg');
  assert.equal(fields.fungsi,undefined,'supplier combined use is not verified technical function');
  assert.equal(fields.mutu,undefined,'supplier combined quality cannot be split as certified mutu');
  assert.equal(fields.standar,undefined,'supplier combined quality cannot be split as certified standard');
  const decision=specificationFormDecision(fields,source,null,'SUPPLEMENT','');
  assert.equal(decision.ok,true);
  if(decision.ok){
    assert.equal(decision.confirmedSpecifications.jenis_kegunaan_sumber,'Cat air');
    assert.equal(decision.confirmedSpecifications.mutu_dan_standar_sumber,'Kategori Ekonomis');
    assert.equal(decision.confirmedSpecifications.fungsi,undefined);
    assert.equal(decision.confirmedSpecifications.mutu,undefined);
    assert.equal(decision.confirmedSpecifications.standar,undefined);
  }
  const editor=readFileSync('src/components/basic-price/BasicPriceSpecificationEditor.tsx','utf8');
  const page=readFileSync('src/pages/BasicPriceReviewPage.tsx','utf8');
  assert.match(editor, /<summary>Keterangan sumber<\/summary>/u);
  assert.match(editor, /Jenis\/kegunaan sumber: \{supplierUse\}/u);
  assert.match(editor, /Mutu\/standar sumber: \{supplierQuality\}/u);
  assert.match(editor, /Semua merek: tidak dibatasi merek tertentu/u);
  assert(editor.indexOf('<summary>Keterangan sumber</summary>') >
    editor.indexOf('identityFieldsForDisplay.map(renderField)'),
    'Source explanations remain accessible after the fields in one collapsed disclosure');
  assert.match(editor, /supplierEvidence\('jenis\/kegunaan', 'jenis_kegunaan_sumber'\)/u);
  assert.match(editor, /supplierEvidence\('mutu dan standar', 'mutu_dan_standar_sumber'\)/u);
  assert.match(page,/Status pemeriksaan spesifikasi/u);
  assert.match(page,/Tinjauan item di atas merupakan proses terpisah/u);
});
test('unrecognized custom kind remains possible without inventing equivalence',()=>{
  const rows=[{kind:'Kapasitas pompa',value:'12,5',unit:'liter/jam'}];
  const saved=writeCapacitySpecification(rows,[]);
  assert.equal(saved.error,undefined);
  assert.deepEqual(readCapacitySpecification(saved.text).rows,rows);
});

test('G123: never present specification save as actionable before existing category authority confirms resource type', () => {
  const editor = readFileSync('src/components/basic-price/BasicPriceSpecificationEditor.tsx', 'utf8');
  const review = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');
  assert.match(review, /saveBlockedReason=\{row\.section === null/u);
  assert.match(editor, /disabled=\{disabled \|\| sending \|\| !decision\.ok \|\| Boolean\(saveBlockedReason\)\}/u);
  assert.match(editor, /\{saveBlockedReason\}<[\/]p>/u);
  assert.match(review, /Konfirmasi Jenis pada panel Pilih Penyelesaian terlebih dahulu/u);
});
