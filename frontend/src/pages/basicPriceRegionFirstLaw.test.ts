import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';
const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../backend/src/basic-price/basic-price.service.ts', import.meta.url), 'utf8');

test('Owner: default region-first navigates the full canonical server grouped index', () => {
  assert.match(page, /regionBrowse: 'true'/);
  assert.match(page, /regionGroup,/);
  assert.match(page, /state\.regionIndex\.provinces\.map/);
  assert.match(page, /state\.regionIndex\.unverified\.count/);
  assert.match(page, /selectedRegionGroup === city\.key/);
  assert.match(page, /Jelajahi wilayah/);
  assert.doesNotMatch(page, /state\.items\.reduce\([^)]*region/u);
});
test('group pagination retains server-side 50 and canonical one row detail', () => {
  assert.match(page, /limit: 50,/);
  assert.match(page, /item\.basicPriceId/);
  assert.match(page, /<BasicPriceDetailPanel/);
  assert.match(service, /this\.prisma\.basicPrice\.groupBy\(/);
  assert.match(service, /this\.prisma\.basicPrice\.findMany\(/);
});
test('region group switches are passed via the existing query without adding tenant identity', () => {
  const p = buildExplorerQueryParams({
    regionBrowse: 'true', regionGroup: 'city:20000000-0000-4000-8000-000000000002',
    sortBy: 'resourceName', sortOrder: 'asc', page: 2, limit: 50,
  });
  assert.equal(p.regionBrowse, 'true');
  assert.equal(p.regionGroup, 'city:20000000-0000-4000-8000-000000000002');
  assert.equal(p.sortBy, 'resourceName');
  assert.equal(p.page, '2');
  assert.ok(!Object.hasOwn(p, 'workspaceId'));
});
test('unknown historical region is presented separately, not assigned to guessed city', () => {
  assert.match(page, /Wilayah belum terverifikasi/);
  assert.doesNotMatch(page, /\(Kec\.\)/);
});
