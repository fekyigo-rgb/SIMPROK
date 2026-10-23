import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manual = readFileSync(new URL('./AhspManualPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/ahsp.css', import.meta.url), 'utf8');

test('the shared formula empty state spans the full row', () => {
  const empty = manual.indexOf('Belum ada baris. Cari di katalog di atas.');
  assert.ok(empty > 0);
  assert.equal(manual.split('Belum ada baris. Cari di katalog di atas.').length - 1, 1);
  const opening = manual.slice(manual.lastIndexOf('<td', empty), manual.indexOf('>', manual.lastIndexOf('<td', empty)));
  assert.match(opening, /colSpan=\{4\}/);
  assert.match(opening, /ahsp-manual-comp__empty/);
  assert.equal(opening.includes('ahsp-line'), false);
  assert.ok(manual.indexOf('<th>Sumber Daya</th>') < empty);
  assert.ok(manual.indexOf('<th>Satuan</th>') < empty);
  assert.ok(manual.indexOf('<th>Koefisien</th>') < empty);
  assert.ok(manual.indexOf('<th>Aksi</th>') < empty);
  assert.match(
    css,
    /\.ahsp-resource-columns td\.ahsp-manual-comp__empty \{\s*overflow-wrap: normal;/,
  );
});

test('Tenaga, Bahan, and Peralatan share one accessible table and adapt to the available width', () => {
  const grid = manual.indexOf('ahsp-manual-comp-grid');
  const tenaga = manual.indexOf('title="Tenaga Kerja"');
  const bahan = manual.indexOf('title="Bahan"');
  const peralatan = manual.indexOf('title="Peralatan"');
  assert.ok(grid < tenaga && tenaga < bahan && bahan < peralatan);
  assert.equal(manual.split('ManualResourceGroupPanel').length - 1 >= 4, true);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 23rem\), 1fr\)\)/);
  assert.match(css, /container: ahsp-manual-formula \/ inline-size/);
  assert.match(css, /@container ahsp-manual-formula/);
  assert.match(css, /\.ahsp-manual-comp__table-scroll \{[^}]*overflow-x: auto/s);
  assert.match(css, /\.ahsp-manual-comp__table\.ahsp-resource-columns th \{[^}]*white-space: nowrap/s);
  assert.match(css, /\.ahsp-resource-columns \.ahsp-col-unit,\s*\.ahsp-resource-columns \.ahsp-col-coef \{\s*width: 7\.5rem;/);
  assert.match(css, /\.ahsp-manual-comp__table\.ahsp-resource-columns \.ahsp-col-unit,\s*\.ahsp-manual-comp__table\.ahsp-resource-columns \.ahsp-col-coef \{\s*width: 5\.5rem;/);
  assert.match(manual, /<div className="ahsp-manual-comp__table-scroll">[\s\S]*?<table className="ahsp-manual-comp__table ahsp-resource-columns">/);
  assert.equal(manual.includes('Tambah Resource'), true);
  assert.equal(manual.includes('Cari sumber daya'), true);
  assert.equal(manual.includes('<td>{row.resourceName'), false);
  assert.equal(manual.includes('row.resourceName || row.resourceId'), true);
});
test('Keterangan starts aligned with Kode AHSP and remains vertically expandable', () => {
  assert.match(manual, /aria-label="Keterangan"\s+rows=\{1\}/);
  assert.match(css, /\.ahsp-manual-info-grid__keterangan textarea\.ahsp-field__control \{[^}]*height: 2\.5rem;[^}]*min-height: 2\.5rem;[^}]*resize: vertical;/s);
});
