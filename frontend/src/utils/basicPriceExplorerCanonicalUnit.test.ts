import assert from 'node:assert/strict';
import test from 'node:test';
import { explorerVerifiedUnitLabel } from './basicPriceExplorerDisplay.ts';

const resource = (baseUnit: string, displayUnit?: string | null) =>
  ({ id: 'resource', code: null, name: 'Peralatan', type: 'EQUIPMENT', baseUnit, displayUnit });

test('BP-C3: Explorer and Detail use same verified unit symbol independent of source alias', () => {
  assert.equal(explorerVerifiedUnitLabel(resource('U/J', 'jam-alat')), 'jam-alat');
  assert.equal(explorerVerifiedUnitLabel(resource('EQUIPMENT_HOUR', 'jam-alat')), 'jam-alat');
  assert.equal(explorerVerifiedUnitLabel(resource('UNIT/JAM', null)), 'Perlu verifikasi');
});

test('BP-C3: old API response preserves original instead of inferring a different identity', () => {
  assert.equal(explorerVerifiedUnitLabel(resource('U/J')), 'U/J');
});
