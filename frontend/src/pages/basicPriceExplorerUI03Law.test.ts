import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplorerQueryParams } from '../utils/basicPriceExplorerDisplay.ts';

const page = readFileSync(new URL('./BasicPriceExplorerPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/basicPrice.css', import.meta.url), 'utf8');
const ahsp = readFileSync(new URL('../styles/ahsp.css', import.meta.url), 'utf8');

test('Koleksi uses the canonical API filter, not client-side filtering of one page', () => {
  assert.equal(buildExplorerQueryParams({}).assetScope, undefined);
  assert.equal(buildExplorerQueryParams({ collection: 'WORKSPACE_PRIVATE' }).assetScope, 'WORKSPACE_PRIVATE');
  assert.equal(buildExplorerQueryParams({ collection: 'SIMPROK_CATALOG' }).assetScope, 'SIMPROK_CATALOG');
  assert.match(page, /collection: collection \|\| undefined/);
  assert.doesNotMatch(page, /state\.items\.filter\([^)]*assetScope/s);
  assert.doesNotMatch(page, /\bassetScope\b/);
});

test('Koleksi is beside the existing sort and has three Owner-approved labels', () => {
  assert.match(page, /className="bp-tablebar__controls"/);
  assert.match(page, /aria-label="Filter koleksi harga"/);
  assert.match(page, /<option value="">Semua harga<\/option>/);
  assert.match(page, /<option value="WORKSPACE_PRIVATE">Harga Privat<\/option>/);
  assert.match(page, /<option value="SIMPROK_CATALOG">Pustaka SIMPROK<\/option>/);
  assert.match(page, /setCollection\(''\)/);
  assert.match(page, /\[draft, collection, sortOrder, page, reloadNonce, regionGroup, itemGroup\]/);
});

test('Explorer header reuses exactly AHSP blue, scoped to this table only', () => {
  assert.match(ahsp, /\.ahsp-room__table th\s*\{[^}]*var\(--simprok-trust-blue-500\)/s);
  assert.match(page, /<table className="bp-table bp-table--explorer">/);
  assert.match(css, /\.bp-table\.bp-table--explorer thead th\s*\{[^}]*background: var\(--simprok-trust-blue-500\);[^}]*color: var\(--simprok-white\);/s);
  assert.match(css, /\.bp-table thead th\s*\{[^}]*background: var\(--simprok-engineering-blue-50\);/s);
});
