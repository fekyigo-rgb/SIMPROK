import assert from 'node:assert/strict';
import test from 'node:test';
import { presentedAhspOutputUnitSymbol } from './unitSuggestionLabel.ts';

test('AHSP length/area/volume presentation follows verified canonical identity, never source spelling', () => {
  for (const [code, expected, aliases] of [
    ['M1', 'm', ['m', 'M', 'm1', 'M1', 'meter', 'metre']],
    ['M2', 'm²', ['m2', 'M2', 'm²', 'meter persegi']],
    ['M3', 'm³', ['m3', 'M3', 'm³', 'meter kubik']],
  ] as const) {
    for (const raw of aliases) {
      assert.equal(presentedAhspOutputUnitSymbol({ stored: raw, code, symbol: code.toLowerCase() }), expected);
    }
  }
});

test('AHSP does not guess an unresolved or contradictory raw unit', () => {
  assert.equal(presentedAhspOutputUnitSymbol({ stored: 'M1' }), 'M1');
  assert.equal(presentedAhspOutputUnitSymbol({ stored: 'm1', symbol: null, code: null }), 'm1');
  assert.equal(presentedAhspOutputUnitSymbol({ stored: 'm²', symbol: 'another', code: null }), 'another');
  assert.equal(presentedAhspOutputUnitSymbol({ stored: 'kg', displayName: 'Kilogram', symbol: 'kg', code: 'KG' }), 'Kilogram');
  assert.equal(presentedAhspOutputUnitSymbol({ stored: 'PERSON_DAY', displayName: 'Orang-hari', code: 'PERSON_DAY' }), 'Orang-hari');
});
