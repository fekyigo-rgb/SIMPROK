import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';
const page=readFileSync(new URL('./BasicPriceExplorerPage.tsx',import.meta.url),'utf8');
const picker=readFileSync(new URL('../components/basic-price/ExplorerRegionFilterSelect.tsx',import.meta.url),'utf8');

test('default full-price catalogue has no hidden narrowing or duplicate controls', () => {
  assert.doesNotMatch(page, /browseMode|bp-browse-switch|Jelajahi wilayah/);
  assert.match(page, /\.\.\.regionSelectionQuery\(draft\.region\)/);
  assert.doesNotMatch(page, /itemBrowse:|itemGroup:|itemPage:/);
  const p=buildExplorerQueryParams({sortBy:'resourceName',sortOrder:'asc',page:1,limit:50});
  assert.equal(p.regionBrowse,undefined);
  assert.equal(p.itemBrowse,undefined);
  assert.equal(p.sortBy,'resourceName');
  assert.equal(p.limit,'50');
});

test('special region identity uses existing group route and remains a single field', () => {
  assert.match(page, /\.\.\.regionSelectionQuery\(draft\.region\)/);
  assert.match(picker, /onSelect\(\{ kind: 'unverified' \}\)/);
  assert.match(picker, /onSelect\(\{ kind: 'general' \}\)/);
  assert.match(picker, /regionChosenLabel\(selected\)/);
  assert.match(picker, /Hapus filter wilayah/);
  assert.match(page, /<div className="bp-tablebar">/);
});

test('filter updates reset table pagination, selection and Detail', () => {
  const change=page.match(/const updateDraft = [\s\S]*?\(key: K, value: DraftFilters\[K\]\) => \{([\s\S]*?)\n  \};/);
  assert.ok(change);
  for(const str of ['setDraft(', 'replaceSelectedIds(new Set())','setPage(1)','setOpenDetailId(null)']) assert.ok(change[1].includes(str));
  assert.match(page, /setDraft\(EMPTY_DRAFT\)/);
  assert.match(page, /setSortOrder\('resourceName:asc'\)/);
});
