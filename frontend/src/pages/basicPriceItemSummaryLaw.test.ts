import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../backend/src/basic-price/basic-price.service.ts', import.meta.url), 'utf8');

test('Owner: no automatic first Resource ID selection in the visible product', () => {
  assert.doesNotMatch(page, /itemBrowse:/);
  assert.doesNotMatch(page, /itemGroup:|itemPage:|setItemGroup|selectedItemId/);
  assert.match(page, /state\.items\.map\(\(item\) => \(/);
  assert.match(page, /formatExplorerPrice\(item\.price\)/);
  assert.doesNotMatch(page, /state\.items\.reduce\(/);
});

test('all actual prices in selected region remain on canonical server table and Detail', () => {
  assert.match(page, /limit: 50/);
  assert.match(page, /state\.meta\.total/);
  assert.match(page, /<BasicPriceDetailPanel/);
  assert.match(service, /this\.prisma\.basicPrice\.findMany/);
  assert.match(service, /this\.prisma\.basicPrice\.count/);
});

test('PR256 smart item index remains in canonical backend, never rebuilt as a second UI truth', () => {
  assert.match(service, /by: \['resourceId'\]/);
  assert.match(service, /buildBasicPriceItemIndex/);
  assert.match(service, /pageBasicPriceItems/);
  assert.match(service, /selectedItemId \? \{ resourceId: selectedItemId \}/);
  assert.doesNotMatch(page, /bp-item-summary|Pilih item A-Z/);
});
