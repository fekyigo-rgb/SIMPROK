import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';

const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../backend/src/basic-price/basic-price.service.ts', import.meta.url), 'utf8');

test('BP item summary uses server-authored complete resource counts, not the 50 visible rows', () => {
  assert.match(page, /state\.itemIndex\.items\.map/);
  assert.match(page, /state\.itemIndex\.totalItems/);
  assert.match(page, /state\.itemIndex\.totalPrices/);
  assert.match(page, /state\.selectedItemId === item\.id/);
  assert.match(service, /by: \['resourceId'\]/);
  assert.match(service, /this\.prisma\.basicPrice\.groupBy/);
});
test('item selection narrows only canonical IDs and preserves 50-row server paging and Detail', () => {
  assert.match(page, /itemBrowse: 'true'/);
  assert.match(page, /itemGroup,/);
  assert.match(page, /setItemGroup\(id\)/);
  assert.match(page, /limit: 50/);
  assert.match(page, /<BasicPriceDetailPanel/);
  assert.match(service, /selectedItemId \? \{ resourceId: selectedItemId \}/);
});
test('query contract carries item group only when defined and never includes a workspace ID', () => {
  const params = buildExplorerQueryParams({
    regionBrowse: 'true',
    regionGroup: 'general',
    itemBrowse: 'true',
    itemGroup: '10000000-0000-4000-8000-000000000001',
    limit: 50, page: 2, itemPage: 3,
  });
  assert.equal(params.itemBrowse, 'true');
  assert.equal(params.itemGroup, '10000000-0000-4000-8000-000000000001');
  assert.equal(params.regionGroup, 'general');
  assert.equal(params.page, '2');
  assert.equal(params.itemPage, '3');
  assert.equal(params.workspaceId, undefined);
});
test('raw prices remain unmodified; no computed average / price merging on frontend', () => {
  assert.match(page, /state\.items\.map\(\(item\) => \(/);
  assert.match(page, /formatExplorerPrice\(item\.price\)/);
  assert.doesNotMatch(page, /itemIndex\.items\.reduce\(/);
});

test('item list is bounded and gets a separate pager from raw price pages', () => {
  assert.match(page, /state\.itemIndex\.totalPages/u);
  assert.match(page, /chooseItemPage\(/u);
  assert.match(page, /setItemPage\(nextPage\)/u);
  assert.match(page, /itemPage,/u);
});