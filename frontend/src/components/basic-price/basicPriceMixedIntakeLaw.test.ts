import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mixed = readFileSync('src/components/basic-price/BasicPriceMixedIntakeDecision.tsx', 'utf8');
const intake = readFileSync('src/components/basic-price/IntakeQuestion.tsx', 'utf8');
const css = readFileSync('src/styles/bpMixedIntake.css', 'utf8');
const page = readFileSync('src/pages/BasicPriceImportPage.tsx', 'utf8');
const api = readFileSync('src/api/basicPriceImport.ts', 'utf8');
const review = readFileSync('src/pages/BasicPriceReviewPage.tsx', 'utf8');

test('BP205-UI-01 four explicit file-composition cards, never MIXED ResourceType', () => {
  for (const value of ['LABOR', 'MATERIAL', 'EQUIPMENT', 'MIXED']) {
    assert.match(mixed, new RegExp("value: '" + value + "'"));
  }
  assert.match(mixed, /default visible checked radio|useState<FileComposition>\('MIXED'\)/u);
  assert.match(mixed, /name="bp-file-composition"/u);
  assert.match(mixed, /onClick=\{\(\) => onContinue\(choice\)\}/u);
  assert.match(api, /declaredSection\?: ResourceType \| 'MIXED'/u);
  assert.match(intake, /question.kind === 'file-composition'/u);
  assert.match(mixed, /Lanjutkan/u);
});

test('BP205-UI-02 exact owner approved visual design and four construction icons', () => {
  assert.match(css, /#FFF8EE/u);
  assert.match(css, /#FFD38B/u);
  assert.match(css, /#087BFF/u);
  assert.match(css, /#EDF6FF/u);
  assert.match(css, /@media \(max-width:1099px\)/u);
  assert.match(css, /@media \(max-width:699px\)/u);
  for (const icon of ['HardHat', 'Boxes', 'Construction', 'ListChecks', 'Layers']) assert.ok(mixed.includes(icon));
  assert.match(mixed, /Disarankan/u);
  assert.match(mixed, /Apa isi daftar harga ini\?/u);
  assert.match(mixed, /Baris yang belum jelas akan ditandai untuk ditinjau/u);
});

test('BP205-UI-03 only genuine preview can show success notice; example explicitly illustrative', () => {
  assert.match(page, /question\?\.kind === 'file-composition'/u);
  assert.match(page, /Berkas berhasil dibaca/u);
  assert.match(mixed, /Contoh ilustrasi, bukan data dari berkas Anda/u);
  assert.match(mixed, /aria-expanded=\{showExample\}/u);
});

test('BP205-EDIT-01: category edit opens the same-row type decision, not catalog or new-item admission', () => {
  assert.match(review, /categoryEditRows\.has\(row\.id\)/u);
  assert.doesNotMatch(review, /Tutup Pilihan Jenis/u);
  assert.match(review, /Pemilih jenis ada di panel penyelesaian sebelah kanan/u);
  assert.match(review, /Ubah Jenis/u);
  assert.match(review, /id=\{`bp-category-editor-\$\{row\.id\}`\}/u);
  assert.match(review, /categoryDrafts\[row\.id\] \?\? row\.section/u);
  assert.match(review, /onClick=\{\(\) => void handleConfirmCategory\(row\)\}/u);
  assert.match(review, /setCategoryEditRows\(\(current\)/u);
  assert.match(review, /Nama, satuan, dan harga asli Excel tetap disimpan/u);
  assert.match(review, /resource: null, unit: null/u);
  assert.match(review, /setTouchedRowIds\(\(current\) => new Set\(current\)\.add\(row\.id\)\)/u);
});

test('BP205-EDIT-02: source unit is read-only; the existing decision-side picker is the only selector and writer', () => {
  assert.doesNotMatch(review, /Pilih\/Ubah Satuan|pendingUnitFocusRow/u);
  assert.match(review, /<CatalogSearchSelect[\s\S]*?mode="unit"/u);
  assert.match(review, /Pilih Satuan/u);
  assert.match(review, /Pilih Item yang Sesuai Padanan/u);
  assert.match(review, /Gunakan Satuan/u);
  assert.match(review, /Gunakan Pilihan/u);
  assert.match(review, /Belum bisa disimpan: \{unitCorrectionMissing \?[^}]+: blockReason\}/u);
  assert.match(review, /await resolveBasicPriceImportRow\(batchId, row\.id, row\.version, draft\.resource\.id, draft\.unit\.id, resolutionAuditReason \|\| undefined\)/u);
});
test('BP205-UI-04 review offers auditable resolution for rows without source-proven category', () => {
  assert.match(review, /Tentukan Jenis/u);
  assert.match(review, /confirmBasicPriceImportRowCategory/u);
  assert.match(review, /row.section === null \|\| row.sectionProvenance === 'UPLOADER_DECLARED'/u);
  assert.match(review, /sourceCategoryName\?\.trim\(\)/u);
  assert.match(review, /Berhasil: jenis baris/u);
  assert.match(review, /Baris ini sedang diproses\. Muat ulang hasil peninjauan/u);
  assert.match(review, /ROW_BUSY_RETRY/u);
});
