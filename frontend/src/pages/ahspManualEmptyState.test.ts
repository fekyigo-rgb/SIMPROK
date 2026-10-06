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

test('Tenaga, Bahan, and Peralatan share that one table, and the cards stay three columns', () => {
  const grid = manual.indexOf('ahsp-manual-comp-grid');
  const tenaga = manual.indexOf('title="Tenaga Kerja"');
  const bahan = manual.indexOf('title="Bahan"');
  const peralatan = manual.indexOf('title="Peralatan"');
  assert.ok(grid < tenaga && tenaga < bahan && bahan < peralatan);
  assert.equal(manual.split('ManualResourceGroupPanel').length - 1 >= 4, true);
  assert.equal(
    css.includes('.ahsp-manual-comp-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));'),
    true,
  );
  assert.equal(manual.includes('Tambah Resource'), true);
  assert.equal(manual.includes('Cari sumber daya'), true);
  assert.equal(manual.includes('<td>{row.resourceName'), false);
  assert.equal(manual.includes('row.resourceName || row.resourceId'), true);
});
