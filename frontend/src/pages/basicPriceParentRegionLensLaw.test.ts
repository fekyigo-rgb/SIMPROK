import test from 'node:test';
import assert from 'node:assert/strict';
import { regionSelectionQuery } from '../utils/basicPriceExplorerDisplay.ts';

test('parent Wilayah selection browses canonical descendant observations, not exact region applicability', () => {
  const province = { id: 'province-1', code: '31', name: 'DKI Jakarta', administrativeLevel: 'PROVINCE' };
  const city = { id: 'city-1', code: '31.74', name: 'Jakarta Selatan', administrativeLevel: 'REGENCY_CITY' };
  assert.deepEqual(regionSelectionQuery(province), { regionBrowse: 'true', regionGroup: 'province-all:province-1' });
  assert.deepEqual(regionSelectionQuery(city), { regionBrowse: 'true', regionGroup: 'city:city-1' });
});

test('district, village, unknown-legacy, and empty selection keep strict canonical identity', () => {
  const selected = { id: 'district-1', code: '31.74.08', name: 'Pancoran', administrativeLevel: 'DISTRICT' };
  assert.deepEqual(regionSelectionQuery(selected), { regionId: 'district-1' });
  assert.deepEqual(regionSelectionQuery({ ...selected, administrativeLevel: 'VILLAGE' }), { regionId: 'district-1' });
  assert.deepEqual(regionSelectionQuery({ ...selected, administrativeLevel: null }), { regionId: 'district-1' });
  assert.deepEqual(regionSelectionQuery(null), {});
});

test('special scopes remain reachable inside one existing Wilayah field, no item auto-selection', () => {
  assert.deepEqual(regionSelectionQuery({ kind: 'unverified' }), { regionBrowse: 'true', regionGroup: 'unverified' });
  assert.deepEqual(regionSelectionQuery({ kind: 'general' }), { regionBrowse: 'true', regionGroup: 'general' });
});
