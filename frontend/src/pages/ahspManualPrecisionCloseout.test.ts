import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  pendingPathFromSelection,
  readableClassificationPaths,
  vocabularyOptionId,
  vocabularyOptionName,
  vocabularyOptionParent,
} from '../utils/ahspBaselineVocabulary.ts';
import { manualAdmissionFailure } from '../utils/ahspManualAdmission.ts';

const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');
const panel = readFileSync('src/components/AhspImportAssistedClassificationPanel.tsx', 'utf8');
const version = readFileSync('../backend/src/ahsp/services/ahsp-version.service.ts', 'utf8');

test('a catalog 409 binds only when the answer carries the existing resource', () => {
  const bound = manualAdmissionFailure(409, {
    resource: { id: 'cat-pekerja', name: 'Pekerja', baseUnit: 'OH' },
  });
  assert.deepEqual(bound, {
    kind: 'bind',
    resource: { id: 'cat-pekerja', name: 'Pekerja', baseUnit: 'OH' },
  });
  const unitRefusal = manualAdmissionFailure(409, { message: 'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY' });
  assert.equal(unitRefusal.kind, 'message');
  if (unitRefusal.kind === 'message') {
    assert.equal(unitRefusal.text.includes('katalog'), false);
    assert.equal(unitRefusal.text.includes('Satuan'), true);
  }
  const bare = manualAdmissionFailure(409, { message: 'RESOLVED_RESOURCE_NOT_VISIBLE' });
  assert.equal(bare.kind, 'message');
  if (bare.kind === 'message') assert.equal(bare.text.includes('cari nama ini di katalog'), false);
});

test('admission name uses the same catalog search and can be chosen directly', () => {
  assert.equal(manual.includes("apiFetch(`/ahsp/resource-search?${params.toString()}`)"), true);
  assert.equal(manual.includes('Pilih yang ada untuk memakainya langsung'), true);
  assert.equal(manual.includes('cari nama ini di katalog'), false);
  assert.equal(manual.includes('addHit(hit)'), true);
});

test('two leaves stay two paths and do not become a cartesian product', () => {
  const root = 'root-konstruksi';
  const bina = vocabularyOptionId('KATEGORI', root, 'Bina Marga');
  const cipta = vocabularyOptionId('KATEGORI', root, 'Cipta Karya');
  const air = vocabularyOptionId('SUBKATEGORI', cipta, 'Air Minum');
  const galian = vocabularyOptionId('JENIS_PEKERJAAN', air, 'Galian');
  const bersih = vocabularyOptionId('JENIS_PEKERJAAN', air, 'Pembersihan Lahan');
  const names = new Map([
    [bina, 'Bina Marga'],
    [cipta, 'Cipta Karya'],
    [air, 'Air Minum'],
    [galian, 'Galian'],
    [bersih, 'Pembersihan Lahan'],
  ]);
  const nameOf = (id: string) => names.get(id) ?? vocabularyOptionName(id);
  const parentOf = (id: string) => vocabularyOptionParent(id);
  const galianPath = pendingPathFromSelection({ jenisId: galian, nameOf, parentOf });
  const bersihPath = pendingPathFromSelection({ jenisId: bersih, nameOf, parentOf });
  assert.deepEqual(galianPath, {
    kategori: 'Cipta Karya',
    subkategori: 'Air Minum',
    jenisPekerjaan: 'Galian',
  });
  assert.deepEqual(bersihPath?.kategori, 'Cipta Karya');
  assert.equal(galianPath?.kategori === 'Bina Marga', false);
  const lines = readableClassificationPaths({
    rootName: 'Pekerjaan Konstruksi',
    pendingPaths: [galianPath!, bersihPath!],
    leafIds: [],
    nameOf,
    parentOf,
  });
  assert.deepEqual(lines, [
    'Pekerjaan Konstruksi → Cipta Karya → Air Minum → Galian',
    'Pekerjaan Konstruksi → Cipta Karya → Air Minum → Pembersihan Lahan',
  ]);
  assert.equal(lines.some((line) => line.includes('Bina Marga')), false);
});

test('outside click and Escape dismiss the open menu without clearing selection', () => {
  assert.equal(panel.includes("if (event.key === 'Escape') props.onDismiss()"), true);
  assert.equal(panel.includes('rootRef.current?.contains(event.target as Node)'), true);
  assert.equal(panel.includes('document.addEventListener(\'pointerdown\', onPointerDown)'), true);
  assert.equal(panel.includes('onDismiss={() => setOpenMenu(null)}'), true);
  assert.equal(panel.includes('setSelectedKategoriIds(new Set())'), true);
  const dismiss = panel.slice(panel.indexOf('const onKeyDown'), panel.indexOf('document.addEventListener'));
  assert.equal(dismiss.includes('setSelected'), false);
});

test('opening another menu still replaces the previous open menu', () => {
  assert.equal(panel.includes("setOpenMenu((m) => (m === 'kategori' ? null : 'kategori'))"), true);
  assert.equal(panel.includes("setOpenMenu((m) => (m === 'sub' ? null : 'sub'))"), true);
  assert.equal(panel.includes("setOpenMenu((m) => (m === 'jenis' ? null : 'jenis'))"), true);
  assert.equal(panel.includes('if (closeMenu) setOpenMenu(null)'), true);
});

test('chip removal calls the same toggle that unchecking uses', () => {
  assert.equal(panel.includes('onRemove={(id) => void toggleKategori(id)}'), true);
  assert.equal(panel.includes('onRemove={(id) => void toggleSubkategori(id)}'), true);
  assert.equal(panel.includes('onRemove={(id) => toggleJenis(id)}'), true);
  assert.equal(panel.includes('Hapus ${chip.name}'), true);
  assert.equal(panel.includes('stillValidSub'), true);
  assert.equal(panel.includes('stillValidJenis'), true);
});

test('manual output unit is resolved by the existing version writer', () => {
  assert.equal(manual.includes('searchUnitDefinitions'), true);
  assert.equal(manual.includes('outputUnit: unit'), true);
  assert.equal(version.includes('this.units.resolve(data.outputUnit, data.outputUnit)'), true);
  assert.equal(version.includes('outputUnitDefinitionId'), true);
  assert.equal(version.includes('outputUnit: data.outputUnit'), true);
});

test('a formula row shows the selected unit display name and keeps the canonical code', () => {
  assert.equal(manual.includes('unitSuggestionLabels({'), true);
  assert.equal(manual.includes('displayName: row.unitDisplayName'), true);
  assert.equal(manual.includes('code: row.baseUnit'), true);
  assert.equal(manual.includes('baseUnit: resource.baseUnit'), true);
  assert.equal(manual.includes('unitDefinitionId: unit.id'), true);
  assert.equal(manual.includes("baseUnit: 'PERSON_DAY'"), false);
});

test('Dasar and Penerbit keep a typed space while Escape still closes the menu', () => {
  assert.equal(panel.includes('dasarAcuan: e.target.value.trim() || null'), false);
  assert.equal(panel.includes('penerbit: e.target.value.trim() || null'), false);
  assert.equal(panel.includes("dasarAcuan: next.trim() === '' ? null : next"), true);
  assert.equal(panel.includes("penerbit: next.trim() === '' ? null : next"), true);
  assert.equal(panel.includes("if (event.key === 'Escape') props.onDismiss()"), true);
  assert.equal(panel.includes('document.addEventListener(\'pointerdown\', onPointerDown)'), true);
  const keepTyped = (value: string) => (value.trim() === '' ? null : value);
  assert.equal(keepTyped('Kementerian PUPR'), 'Kementerian PUPR');
  assert.equal(keepTyped('Peraturan Menteri PUPR Nomor 1 Tahun 2025'), 'Peraturan Menteri PUPR Nomor 1 Tahun 2025');
});
