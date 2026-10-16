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

test('BP205-UI-04 review offers auditable resolution for rows without source-proven category', () => {
  assert.match(review, /Tentukan Jenis/u);
  assert.match(review, /confirmBasicPriceImportRowCategory/u);
  assert.match(review, /row.section === null \|\| row.sectionProvenance === 'UPLOADER_DECLARED'/u);
  assert.match(review, /sourceCategoryName\?\.trim\(\)/u);
  assert.match(review, /Berhasil: jenis baris/u);
});
