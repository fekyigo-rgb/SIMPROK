import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basicPriceRegionDetailFacts,
  basicPriceRegionLabel,
  type BasicPriceExplorerItem,
} from './basicPriceExplorerDisplay.ts';

const base = {
  basicPriceId: 'bp-1',
  resource: { id: 'r', code: 'M04', name: 'Agregat Halus', type: 'MATERIAL', baseUnit: 'M3' },
  region: { id: 'district-id', code: '31.74.04', name: 'Pancoran' },
  price: '325000.00', effectiveDate: '2026-10-01', validUntil: null,
  sourceType: 'PRIVATE', sourceOrigin: 'STORE', sourceName: 'Tim Simprok',
  freshnessStatus: 'CURRENT', workspaceScope: 'WORKSPACE',
} as BasicPriceExplorerItem;

test('region list stays compact, detail uses canonical ancestor levels', () => {
  const item: BasicPriceExplorerItem = { ...base, regionPath: [
    { id: 'prov', name: 'DKI Jakarta', administrativeLevel: 'PROVINCE' },
    { id: 'city', name: 'Kota Jakarta Selatan', administrativeLevel: 'REGENCY_CITY' },
    { id: 'district-id', name: 'Pancoran', administrativeLevel: 'DISTRICT' },
  ] };
  assert.equal(basicPriceRegionLabel(item), 'Pancoran');
  assert.deepEqual(basicPriceRegionDetailFacts(item).slice(0, 4), [
    { label: 'Provinsi', value: 'DKI Jakarta' },
    { label: 'Kabupaten/Kota', value: 'Kota Jakarta Selatan' },
    { label: 'Kecamatan', value: 'Pancoran' },
    { label: 'Kelurahan/Desa', value: 'Tidak ditentukan' },
  ]);
});
test('city price remains city scoped, does not fabricate district or village', () => {
  const item: BasicPriceExplorerItem = { ...base, region: { id: 'city', name: 'Kota Jakarta Pusat', code: '31.71' }, regionPath: [
    { id: 'prov', name: 'DKI Jakarta', administrativeLevel: 'PROVINCE' },
    { id: 'city', name: 'Kota Jakarta Pusat', administrativeLevel: 'REGENCY_CITY' },
  ] };
  assert.equal(basicPriceRegionLabel(item), 'Kota Jakarta Pusat');
  assert.equal(basicPriceRegionDetailFacts(item)[2].value, 'Tidak ditentukan');
});
test('legacy unknown ancestry never becomes a guessed province', () => {
  const item: BasicPriceExplorerItem = { ...base, regionPath: [
    { id: 'district-id', name: 'Pancoran', administrativeLevel: null },
  ] };
  assert.equal(basicPriceRegionDetailFacts(item)[0].value, 'Tidak ditentukan');
  assert.match(basicPriceRegionDetailFacts(item).at(-1)?.value ?? '', /belum terverifikasi/);
});
test('general scope carries no invented administrative facts', () => {
  const item: BasicPriceExplorerItem = { ...base, region: null, regionPath: null };
  assert.deepEqual(basicPriceRegionDetailFacts(item), [{ label: 'Cakupan wilayah', value: 'Umum (tanpa wilayah)' }]);
});

test('P1: multiple stored villages are displayed by name and alphabetical order', () => {
  const item: BasicPriceExplorerItem = { ...base, regionCoverageSummary: '3 Desa/Kelurahan di Pancoran',
    regionPath: [{ id: 'district-id', name: 'Pancoran', administrativeLevel: 'DISTRICT' }] };
  const facts = basicPriceRegionDetailFacts(item, [
    { name: 'Kalibata', administrativeLevel: 'VILLAGE' },
    { name: 'Duren Tiga', administrativeLevel: 'VILLAGE' },
    { name: 'Pengadegan', administrativeLevel: 'VILLAGE' },
  ]);
  assert.equal(facts.find(f=>f.label==='Kelurahan/Desa')?.value,
    'Duren Tiga, Kalibata, Pengadegan');
  assert.ok(!facts.some(f => f.label==='Rincian anggota cakupan'));
});
test('P1: one coverage member is not lost through summary count threshold', () => {
  assert.equal(basicPriceRegionDetailFacts(base, [
    { name: 'Senen', administrativeLevel: 'VILLAGE' },
  ]).find(f=>f.label==='Kelurahan/Desa')?.value, 'Senen');
});
test('P1: city-wide scope does not invent district or village', () => {
  const item: BasicPriceExplorerItem = { ...base,
    region: { id: '31.71', code: '31.71', name: 'Kota Administrasi Jakarta Pusat' },
    regionPath: [
      { id: '31', name: 'DKI Jakarta', administrativeLevel: 'PROVINCE' },
      { id: '31.71', name: 'Kota Administrasi Jakarta Pusat', administrativeLevel: 'REGENCY_CITY' },
    ],
  };
  assert.equal(basicPriceRegionDetailFacts(item,null).find(f=>f.label==='Kelurahan/Desa')?.value,
    'Tidak ditentukan');
});
test('P1: pending and error states do not invent coverage names', () => {
  const item: BasicPriceExplorerItem = { ...base, regionCoverageSummary: '3 Desa/Kelurahan di Pancoran' };
  assert.equal(basicPriceRegionDetailFacts(item).find(f=>f.label==='Rincian anggota cakupan')?.value, 'Memuat...');
  assert.equal(basicPriceRegionDetailFacts(item,undefined,true).find(f=>f.label==='Rincian anggota cakupan')?.value, 'Belum dapat dimuat');
});
test('P1: unverified member is not silently declared a village', () => {
  const facts=basicPriceRegionDetailFacts(base,[{name:'Wilayah Legacy',administrativeLevel:null}]);
  assert.equal(facts.find(f=>f.label==='Kelurahan/Desa')?.value,'Tidak ditentukan');
  assert.equal(facts.find(f=>f.label==='Anggota cakupan lainnya')?.value,'Wilayah Legacy');
});
