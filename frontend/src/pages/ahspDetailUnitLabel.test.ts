import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { presentedUnitLabel } from '../utils/unitSuggestionLabel.ts';

const detail = readFileSync(new URL('./AhspDetailPage.tsx', import.meta.url), 'utf8');

test('detail reuses the Manual unit label helper for component and output units', () => {
  assert.equal(detail.includes('presentedUnitLabel'), true);
  assert.equal(detail.includes('presentedComponentUnit(row.unit)'), true);
  assert.equal(detail.includes('presentedOutputUnit'), true);
  assert.equal(detail.includes('baseUnit: row.baseUnit.trim()'), true);
  assert.equal(detail.includes('outputUnit: unit'), true);
  assert.equal(detail.includes("baseUnit: 'PERSON_DAY'"), false);
  assert.equal(detail.includes("displayName: 'Orang-hari'"), false);
});

test('stored canonical metadata renders the existing human label', () => {
  assert.equal(
    presentedUnitLabel({ stored: 'PERSON_DAY', displayName: 'Orang-hari', symbol: 'orang-hari', code: 'PERSON_DAY' }),
    'Orang-hari',
  );
  assert.equal(
    presentedUnitLabel({ stored: 'PERSON_MONTH', displayName: 'Orang-bulan', symbol: 'orang-bulan', code: 'PERSON_MONTH' }),
    'Orang-bulan',
  );
  assert.equal(
    presentedUnitLabel({ stored: 'TONNE', displayName: 'Ton metrik', symbol: 't', code: 'TONNE' }),
    'Ton metrik',
  );
  assert.equal(
    presentedUnitLabel({ stored: 'CENTIMETRE', displayName: 'Sentimeter', symbol: 'cm', code: 'CENTIMETRE' }),
    'Sentimeter',
  );
  assert.equal(
    presentedUnitLabel({ stored: 'LS', displayName: 'Lump sum', symbol: 'ls', code: 'LS' }),
    'Lump sum',
  );
  assert.equal(
    presentedUnitLabel({ stored: 'm3', displayName: 'Cubic metre', symbol: 'm3', code: 'M3' }),
    'Cubic metre',
  );
});

test('missing presentation metadata keeps the stored code and does not invent a label', () => {
  assert.equal(presentedUnitLabel({ stored: 'PERSON_DAY' }), 'PERSON_DAY');
  assert.equal(presentedUnitLabel({ stored: 'M3', displayName: null, symbol: null, code: null }), 'M3');
  assert.equal(presentedUnitLabel({ stored: '0.300000' }), '0.300000');
});
