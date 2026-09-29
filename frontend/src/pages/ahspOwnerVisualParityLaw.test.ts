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

const room = codeOnly(readFileSync('src/pages/AhspRoomPage.tsx', 'utf8'));
const manual = codeOnly(readFileSync('src/pages/AhspManualPage.tsx', 'utf8'));
const importPage = codeOnly(readFileSync('src/pages/AhspImportPage.tsx', 'utf8'));
const panel = codeOnly(readFileSync('src/components/AhspImportAssistedClassificationPanel.tsx', 'utf8'));
const app = codeOnly(readFileSync('src/App.tsx', 'utf8'));
const css = codeOnly(readFileSync('src/styles/ahsp.css', 'utf8'));

test('ROOM_INLINE_MANUAL_DUPLICATE=false', () => {
  assert.ok(!room.includes('ahsp-manual-form'));
  assert.ok(!room.includes('manualOpen'));
  assert.ok(room.includes('to="/ahsp/manual"'));
  assert.ok(room.includes('Buat AHSP Manual'));
});

test('ROOM_HAS_JENIS_PENGADAAN_FILTER=true', () => {
  assert.ok(room.includes('Jenis Pengadaan'));
  assert.ok(room.includes('JENIS_PENGADAAN_OPTIONS'));
});

test('ROOM_HAS_DASAR_PRIMARY_FILTER=false', () => {
  assert.ok(!room.includes('Dasar AHSP'));
  assert.ok(!room.includes('Semua Dasar AHSP'));
});

test('ROOM_CANONICAL_KATEGORI_LABEL=true', () => {
  assert.ok(room.includes('Kategori'));
  assert.ok(!room.includes('Bidang / Kategori'));
  assert.ok(room.includes('ahsp-room__table') || room.includes('>Kategori<'));
});

test('IMPORT_NATIVE_CHOOSE_FILE_PRIMARY=false', () => {
  assert.ok(importPage.includes('ahsp-import-upload__native'));
  assert.ok(importPage.includes('ahsp-import-file-card'));
  assert.ok(importPage.includes('Ganti File') || importPage.includes('Pilih berkas'));
});

test('IMPORT_CLASSIFICATION_COMPACT + local add on demand', () => {
  assert.ok(panel.includes('ahsp-multi-select'));
  assert.ok(panel.includes('ahsp-multi-select__chips') || panel.includes('chips='));
  assert.ok(panel.includes('+ Tambahkan pilihan baru'));
  assert.ok(!panel.includes('Tambah jalur klasifikasi'));
});

test('DASAR_PENERBIT_VISUALLY_SEPARATE=true', () => {
  assert.ok(panel.includes('Dasar / Acuan AHSP'));
  assert.ok(panel.includes('Instansi Sumber / Penerbit'));
  assert.ok(panel.includes('ahsp-assisted-meta__dasar'));
  assert.ok(panel.includes('ahsp-assisted-meta__penerbit'));
  assert.ok(css.includes('ahsp-field__label') || panel.includes('ahsp-field__label'));
});

test('RINGKASAN_USES_CONDITION_CARDS=true', () => {
  assert.ok(importPage.includes('ahsp-attention') || importPage.includes('renderAttention'));
  assert.ok(importPage.includes('ahsp-ringkasan'));
  assert.ok(css.includes('ahsp-attention__row'));
  assert.ok(css.includes('ahsp-attention__badge') || css.includes('ahsp-ringkasan__count'));
});

test('CONFIRMATION_TRUTH_UNCHANGED=true', () => {
  assert.ok(importPage.includes('confirmImportFigures'));
  assert.ok(importPage.includes('akan disimpan'));
  assert.ok(importPage.includes('masih perlu ditinjau'));
  assert.ok(css.includes('ahsp-confirm-summary'));
  assert.ok(css.includes('ahsp-confirm-held'));
  assert.ok(importPage.includes('ahsp-confirm-table') || importPage.includes('Daftar Hasil Import'));
});

test('IMPORT_TRUTH_COPY_NO_FALSE_ALL_ACCEPTED=true', () => {
  assert.ok(importPage.includes('IMPORT_JOURNEY_SUBTITLE'));
  assert.ok(!importPage.includes('Semua pekerjaan yang dikenali diterima SIMPROK'));
  assert.ok(!importPage.includes('Saat disimpan, semua pekerjaan yang dikenali diterima'));
});

test('MANUAL door uses atomic POST /ahsp/manual + Keterangan, no Draft button', () => {
  assert.ok(app.includes('ahsp/manual'));
  assert.ok(manual.includes('Buat AHSP Manual'));
  assert.ok(manual.includes("apiFetch('/ahsp/manual'"));
  assert.ok(manual.includes('keterangan'));
  assert.ok(manual.includes('leafNodeIds'));
  assert.ok(manual.includes('/ahsp/resource-search'));
  assert.ok(!manual.includes('searchResourceCatalog'));
  assert.ok(manual.includes('AhspImportAssistedClassificationPanel'));
  assert.ok(!manual.includes('Simpan sebagai Draft'));
  assert.ok(manual.includes('Pakai nama ini hanya pada AHSP ini'));
  assert.ok(manual.includes('Belum di katalog'));
  assert.ok(manual.includes('Pencarian katalog tidak berhasil'));
  assert.ok(manual.includes('sudah ada'));
  assert.ok(manual.includes('submitLock'));
  assert.ok(!manual.includes('belum tersimpan') || manual.includes('Tidak ada bagian yang dinyatakan berhasil'));
  assert.ok(!manual.includes('milik saya'));
});

test('MOJIBAKE=false in Import locked strings', () => {
  assert.ok(!importPage.includes('â€º'));
  assert.ok(!importPage.includes('â†’'));
});
