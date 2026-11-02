import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';
const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const picker = readFileSync(new URL('../components/basic-price/ExplorerRegionFilterSelect.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../backend/src/basic-price/basic-price.service.ts', import.meta.url), 'utf8');

test('Owner: exactly one visible Wilayah entry point; no second browse view', () => {
  assert.match(page, /<ExplorerRegionFilterSelect/);
  assert.doesNotMatch(page, /Jelajahi wilayah &amp; item|bp-browse-switch|bp-region-first|bp-item-summary/);
  assert.doesNotMatch(page, /setBrowseMode|setRegionGroup|setItemGroup|setItemPage/);
  assert.match(picker, /Wilayah belum terverifikasi/);
  assert.match(picker, /Umum \(tanpa wilayah\)/);
  assert.match(picker, /regionOptionLabels\(results\)/);
});

test('verified region remains canonical regionId, not a group guessed from names', () => {
  assert.match(page, /\.\.\.regionSelectionQuery\(draft\.region\)/);
  assert.match(service, /basicPriceRegionApplicabilityWhere\(regionId\)/);
  assert.match(page, /limit: 50,/);
  assert.match(page, /<BasicPriceDetailPanel/);
});

test('unverified and general still reuse canonical backend region index but do not choose first item', () => {
  assert.match(page, /\.\.\.regionSelectionQuery\(draft\.region\)/);
  assert.doesNotMatch(page, /itemBrowse:/);
  assert.doesNotMatch(page, /itemGroup:/);
  assert.match(service, /regionFirstGroupRegionIds\(regionIndex, selectedRegionGroup\)/);
  assert.match(service, /this\.prisma\.basicPrice\.groupBy/);
  const query=buildExplorerQueryParams({regionBrowse:'true',regionGroup:'unverified',limit:50,page:1});
  assert.equal(query.regionGroup,'unverified');
  assert.equal(query.itemBrowse,undefined);
  assert.equal(query.workspaceId,undefined);
});
