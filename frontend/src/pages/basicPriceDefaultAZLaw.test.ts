import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');

test('neutral Basic Price Explorer starts on canonical Item A-Z, not date or local page sorting', () => {
  assert.match(page, /useState<SortChoice>\('resourceName:asc'\)/);
  assert.match(page, /sortBy,\s*sortOrder: sortDirection,/);
  assert.match(page, /limit: 50,/);
  assert.match(page, /\[draft, collection, sortOrder, page, reloadNonce, regionGroup, itemGroup, itemPage\]/);
  assert.doesNotMatch(page, /state\.items\.sort\(/);
});

test('resetting filters restores neutral A-Z order and clears selection/detail', () => {
  const reset = page.match(/const resetFilters = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(reset, 'reset function must exist');
  assert.match(reset[1], /setDraft\(EMPTY_DRAFT\)/);
  assert.match(reset[1], /setCollection\(''\)/);
  assert.match(reset[1], /setSortOrder\('resourceName:asc'\)/);
  assert.match(reset[1], /setPage\(1\)/);
  assert.match(reset[1], /setOpenDetailId\(null\)/);
});

test('all existing manual order options and both column sort arrows remain', () => {
  for (const value of ['effectiveDate:asc', 'effectiveDate:desc',
    'resourceName:asc', 'resourceName:desc', 'price:asc', 'price:desc']) {
    assert.ok(page.includes('value="' + value + '"'), 'missing preset ' + value);
  }
  assert.match(page, /chooseSort\('resourceName'/);
  assert.match(page, /chooseSort\('price'/);
  assert.match(page, /aria-sort=\{sortBy === 'resourceName'/);
  assert.match(page, /aria-sort=\{sortBy === 'price'/);
});
