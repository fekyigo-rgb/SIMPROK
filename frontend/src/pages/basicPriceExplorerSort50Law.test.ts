import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';

const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/basicPrice.css', import.meta.url), 'utf8');

test('50 prices/page are requested from canonical Backend, not client-only slicing', () => {
  assert.match(page, /limit: 50,/);
  assert.doesNotMatch(page, /state\.items\.slice\(0,\s*50\)/);
  assert.equal(buildExplorerQueryParams({ limit: 50 }).limit, '50');
});

test('Item and Harga headers provide actual sortable controls, accessible arrows and aria-sort', () => {
  assert.match(page, /aria-sort=\{sortBy === 'resourceName'/);
  assert.match(page, /aria-sort=\{sortBy === 'price'/);
  assert.match(page, /chooseSort\('resourceName',/);
  assert.match(page, /chooseSort\('price',/);
  assert.match(page, /<ArrowUpDown size=\{12\} aria-hidden/);
  assert.match(page, /<ArrowUp size=\{12\} aria-hidden/);
  assert.match(page, /<ArrowDown size=\{12\} aria-hidden/);
  assert.match(css, /\.bp-table--explorer \.bp-table__sortbtn:focus-visible/);
});

test('Urutkan presets stay synchronized with actual column sorting; date choices preserved', () => {
  assert.match(page, /value=\{sortOrder\}/);
  for (const choice of ['effectiveDate:asc', 'effectiveDate:desc',
    'resourceName:asc', 'resourceName:desc', 'price:asc', 'price:desc']) {
    assert.ok(page.includes('value="' + choice + '"'));
  }
  assert.match(page, /sortBy,\s*sortOrder: sortDirection,/);
  assert.match(page, /\[draft, collection, sortOrder, page, reloadNonce\]/);
  assert.match(page, /setPage\(1\)/);
  assert.match(page, /setOpenDetailId\(null\)/);
});
