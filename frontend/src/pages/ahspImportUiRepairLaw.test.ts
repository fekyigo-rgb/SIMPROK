import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const codeOnly = (source: string) =>
  source
    .split(CR)
    .join('')
    .split(NEWLINE)
    .filter((line) => {
      const t = line.trim();
      return (
        !t.startsWith('//') &&
        !t.startsWith('*') &&
        !t.startsWith('/*') &&
        !t.startsWith('{/*')
      );
    })
    .join(NEWLINE);

const panel = codeOnly(
  readFileSync('src/components/AhspImportAssistedClassificationPanel.tsx', 'utf8'),
);
const importPage = codeOnly(readFileSync('src/pages/AhspImportPage.tsx', 'utf8'));
const room = codeOnly(readFileSync('src/pages/AhspRoomPage.tsx', 'utf8'));
const intake = codeOnly(readFileSync('src/utils/ahspImportIntakeDisplay.ts', 'utf8'));

test('UI-01/06 Kategori dropdown uses shared vocabulary, children API, and local create', () => {
  assert.ok(panel.includes('/ahsp/document/classification/children'));
  assert.ok(panel.includes('createLocal'));
  assert.ok(panel.includes("'KATEGORI'"));
  assert.ok(panel.includes('+ Tambahkan pilihan baru'));
  assert.ok(panel.includes('ahspBaselineVocabulary'));
  assert.ok(panel.includes('baselineKategoriOptions'));
  assert.ok(!panel.includes('const BIDANG'));
});

test('UI-02/03 Subkategori and Jenis use the shared vocabulary and still load stored children', () => {
  assert.ok(panel.includes('loadChildren(id)'));
  assert.ok(panel.includes('baselineSubkategoriOptions'));
  assert.ok(panel.includes('baselineJenisPekerjaanOptions'));
  assert.ok(panel.includes('isVocabularyOptionId(id)'));
});

test('UI-04 soft cascade search reaches outside prioritized branch', () => {
  assert.ok(panel.includes('/ahsp/document/classification/search?'));
  assert.ok(panel.includes("'KATEGORI'"));
  assert.ok(panel.includes("'SUBKATEGORI'"));
  assert.ok(panel.includes("'JENIS_PEKERJAAN'"));
  assert.ok(panel.includes('preferredParentId'));
});

test('UI-05 multi-select preserves paths — no Cartesian arrays as truth', () => {
  assert.ok(panel.includes('leafNodeId'));
  assert.ok(panel.includes('paths.push'));
  assert.ok(!panel.includes('Cartesian'));
});

test('UI-07 Import has no Tambah jalur klasifikasi', () => {
  assert.ok(!importPage.includes('Tambah jalur klasifikasi'));
  assert.ok(!panel.includes('Tambah jalur klasifikasi'));
});

test('UI-08 Import has no Buat/Simpan AHSP milik saya', () => {
  assert.ok(!importPage.includes('Buat AHSP milik saya'));
  assert.ok(!importPage.includes('Simpan AHSP milik saya'));
});

test('UI-09 canonical Buat AHSP Manual remains on AHSP room door', () => {
  assert.ok(room.includes('Buat AHSP Manual'));
  assert.ok(room.includes("apiFetch('/ahsp'"));
});

test('UI-10 Dasar/Acuan and Penerbit are separate fields', () => {
  assert.ok(panel.includes('Dasar / Acuan AHSP'));
  assert.ok(panel.includes('Instansi Sumber / Penerbit'));
  assert.ok(panel.includes('ahsp-assisted-meta__dasar'));
  assert.ok(panel.includes('ahsp-assisted-meta__penerbit'));
});

test('UI-11 no mojibake literals in Import locked strings', () => {
  assert.ok(!importPage.includes('â€º'));
  assert.ok(!importPage.includes('â†’'));
  assert.ok(importPage.includes('\\u203A') || importPage.includes('\u203A'));
});

test('UI-12/13 confirm figures derive willSave independent of needsReview', () => {
  assert.ok(intake.includes('confirmImportFigures'));
  assert.ok(intake.includes('willSave'));
  assert.ok(intake.includes('IDENTITY_PENDING'));
  assert.ok(importPage.includes('confirmImportFigures'));
  assert.ok(importPage.includes('akan disimpan'));
  assert.ok(importPage.includes('masih perlu ditinjau'));
});

test('UI-14 Ringkasan resource identity remains actionable door', () => {
  assert.ok(importPage.includes('openIdentityReview'));
  assert.ok(importPage.includes('row.actionLabel'));
});

test('UI-15 Door A Stage2A connection unchanged', () => {
  assert.ok(importPage.includes("'/resource-observations?sourceSha256='") || importPage.includes('sourceSha256'));
  assert.ok(importPage.includes('/curate-existing') || importPage.includes('curate'));
});

test('UI-17 empty pending-import uses compact surface', () => {
  assert.ok(importPage.includes('ahsp-pending-empty'));
  assert.ok(importPage.includes('Tidak ada import yang menunggu dilengkapi.'));
});
