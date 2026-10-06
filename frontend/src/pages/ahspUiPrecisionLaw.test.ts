import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextJenisSelection } from '../utils/ahspJenisMenu.ts';

const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');
const panel = readFileSync('src/components/AhspImportAssistedClassificationPanel.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('Tenaga, Bahan, and Peralatan share one column geometry', () => {
  assert.equal(detail.includes('ahsp-resource-columns'), true);
  assert.equal(manual.includes('ahsp-resource-columns'), true);
  assert.equal(detail.includes('ahsp-col-unit'), true);
  assert.equal(detail.includes('ahsp-col-coef'), true);
  assert.equal(manual.includes('ahsp-col-unit'), true);
  assert.equal(manual.includes('ahsp-col-coef'), true);
  assert.equal(css.includes('table-layout: fixed'), true);
  assert.equal(
    css.includes('.ahsp-manual-comp-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));'),
    true,
  );
  assert.equal(css.includes('@media (max-width: 1100px)'), true);
  const tenaga = manual.indexOf('title="Tenaga Kerja"');
  const bahan = manual.indexOf('title="Bahan"');
  const peralatan = manual.indexOf('title="Peralatan"');
  assert.ok(tenaga > manual.indexOf('ahsp-manual-comp-grid'));
  assert.ok(tenaga < bahan && bahan < peralatan);
  const unitRule = css.match(/\.ahsp-resource-columns \.ahsp-col-unit,\s*\.ahsp-resource-columns \.ahsp-col-coef \{\s*width: ([^;]+);/);
  assert.ok(unitRule, 'Satuan and Koefisien must share one width rule');
  assert.equal((css.match(/ahsp-col-unit/g) ?? []).length >= 1, true);
  assert.equal(detail.includes("width: '2.5rem'"), false);
  const manualText = manual.replace(/\s+/g, ' ');
  assert.equal(manualText.includes('Tambah Resource'), true);
  assert.equal(manualText.includes('Informasi harga dikelola melalui Basic Price'), true);
});

test('checking a Jenis Pekerjaan keeps the selection and closes the menu', () => {
  const first = nextJenisSelection(new Set(), 'beton');
  assert.equal(first.closeMenu, true);
  assert.deepEqual([...first.ids], ['beton']);
  assert.equal(panel.includes('nextJenisSelection'), true);
  assert.equal(panel.includes('if (closeMenu) setOpenMenu(null)'), true);
  assert.equal(panel.includes('baselineJenisPekerjaanOptions'), true);
});

test('a second Jenis Pekerjaan is added and the first remains', () => {
  const first = nextJenisSelection(new Set(), 'beton');
  const second = nextJenisSelection(first.ids, 'aspal');
  assert.equal(second.closeMenu, true);
  assert.deepEqual([...second.ids], ['beton', 'aspal']);
  const unchecked = nextJenisSelection(second.ids, 'aspal');
  assert.equal(unchecked.closeMenu, false);
  assert.deepEqual([...unchecked.ids], ['beton']);
});
