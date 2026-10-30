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

test('BP-UNIT-DISPLAY-01: verified price unit is the only unit shown on Explorer and Detail', () => {
  assert.equal(explorerVerifiedUnitLabel(resource('M1', 'm')), 'm');
  assert.equal(explorerVerifiedUnitLabel(resource('M2', 'm²')), 'm²');
  assert.equal(explorerVerifiedUnitLabel(resource('M3', 'm³')), 'm³');
  assert.equal(explorerVerifiedUnitLabel(resource('BH_PER_M', 'bh/m')), 'bh/m');
  assert.equal(explorerVerifiedUnitLabel(resource('M1', null)), 'Perlu verifikasi');
});

test('BP-C3: old API response preserves original instead of inferring a different identity', () => {
  assert.equal(explorerVerifiedUnitLabel(resource('U/J')), 'U/J');
});
