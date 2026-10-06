import assert from 'node:assert/strict';
import test from 'node:test';
import { unitSuggestionLabels } from '../utils/unitSuggestionLabel.ts';

const TONNE = {
  id: '10000000-0000-4000-8000-000000000327',
  code: 'TONNE',
  displayName: 'Ton metrik',
  symbol: 't',
  dimension: 'MASS',
};

test('TONNE is named Ton metrik, with the symbol and code behind it', () => {
  assert.deepEqual(unitSuggestionLabels(TONNE), {
    primary: 'Ton metrik',
    secondary: 't · TONNE',
  });
});

test('qualified tons keep their canonical names ahead of their symbols', () => {
  assert.equal(unitSuggestionLabels({ displayName: 'Ton panjang', symbol: 'long ton', code: 'LONG_TON' }).primary, 'Ton panjang');
  assert.equal(unitSuggestionLabels({ displayName: 'Ton pendek', symbol: 'short ton', code: 'SHORT_TON' }).primary, 'Ton pendek');
});

test('a missing display name falls back to the symbol, never an invented name', () => {
  assert.deepEqual(unitSuggestionLabels({ displayName: '', symbol: 'kg', code: 'KG' }), {
    primary: 'kg',
    secondary: 'KG',
  });
});

test('formula units keep the canonical display name ahead of the code', () => {
  assert.equal(unitSuggestionLabels({ displayName: 'Orang-hari', symbol: 'orang-hari', code: 'PERSON_DAY' }).primary, 'Orang-hari');
  assert.equal(unitSuggestionLabels({ displayName: 'Orang-bulan', symbol: 'orang-bulan', code: 'PERSON_MONTH' }).primary, 'Orang-bulan');
  assert.equal(unitSuggestionLabels({ displayName: 'Ton metrik', symbol: 't', code: 'TONNE' }).primary, 'Ton metrik');
  assert.equal(unitSuggestionLabels({ displayName: 'Sentimeter', symbol: 'cm', code: 'CENTIMETRE' }).primary, 'Sentimeter');
  assert.equal(unitSuggestionLabels({ displayName: 'Lump sum', symbol: 'ls', code: 'LS' }).primary, 'Lump sum');
});
