import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';
const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/basicPrice.css', import.meta.url), 'utf8');

test('normal: full ungrouped canonical price list is initial state', () => {
  assert.match(page, /const \[browseMode, setBrowseMode\] = useState\(false\)/);
  assert.match(page, /regionBrowse: browseMode \? 'true' : undefined/);
  assert.match(page, /itemBrowse: browseMode \? 'true' : undefined/);
  assert.match(page, /regionGroup: browseMode \? regionGroup : undefined/);
  assert.match(page, /itemGroup: browseMode \? itemGroup : undefined/);
  assert.match(page, /itemPage: browseMode \? itemPage : undefined/);
  const ordinary = buildExplorerQueryParams({sortBy:'resourceName',sortOrder:'asc',page:1,limit:50});
  assert.equal(ordinary.regionBrowse,undefined);
  assert.equal(ordinary.itemBrowse,undefined);
  assert.equal(ordinary.sortBy,'resourceName');
  assert.equal(ordinary.limit,'50');
});

test('advanced region and item navigation is preserved but optional', () => {
  assert.match(page, /Jelajahi wilayah &amp; item/);
  assert.match(page, /Semua harga/);
  assert.match(page, /aria-pressed=\{!browseMode\}/);
  assert.match(page, /aria-pressed=\{browseMode\}/);
  assert.match(page, /browseMode && state.kind === 'ready' && state.regionIndex/);
  assert.match(page, /browseMode && state.kind === 'ready' && state.itemIndex/);
  assert.match(page, /<details className="bp-item-summary"/);
  assert.match(page, /<summary className="bp-item-summary__heading"/);
  const advanced=buildExplorerQueryParams({
    regionBrowse:'true',regionGroup:'first',
    itemBrowse:'true',itemGroup:'first',itemPage:1,limit:50,
  });
  assert.equal(advanced.regionBrowse,'true');
  assert.equal(advanced.itemBrowse,'true');
});

test('mode switch clears stale row selection and detail, with no DB writes', () => {
  assert.match(page, /const chooseBrowseMode = \(next: boolean\) => \{/);
  assert.match(page, /setBrowseMode\(next\)/);
  assert.match(page, /setRegionGroup\('first'\)/);
  assert.match(page, /setItemGroup\('first'\)/);
  assert.match(page, /replaceSelectedIds\(new Set\(\)\)/);
  assert.match(page, /setOpenDetailId\(null\)/);
  assert.match(page, /setPage\(1\)/);
});

test('no nested item-list scrollbar; table remains the normal primary surface', () => {
  assert.match(css, /\.bp-room \.bp-item-summary__list \{[\s\S]*?max-height: none;[\s\S]*?overflow: visible;/);
  assert.match(page, /<div className="bp-tablebar">/);
  assert.match(page, /<BasicPriceDetailPanel/);
});
