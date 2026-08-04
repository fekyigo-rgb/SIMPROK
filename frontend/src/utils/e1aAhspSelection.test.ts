import assert from 'node:assert/strict';
import test from 'node:test';
import { describeE1aOccurrence } from './e1aAhspSelection.ts';

test('whole-version RESOLVED is honestly labelled calculated but not frozen', () => {
  assert.deepEqual(
    describeE1aOccurrence({ id: 'o', generation: 1, resourceResolutions: [{ status: 'RESOLVED' }] }),
    { label: 'Terhitung  Belum Dibekukan', canCalculate: true },
  );
});

test('UNRESOLVED and NEEDS_REVIEW fail closed', () => {
  assert.equal(describeE1aOccurrence({ id: 'o', generation: 1, resourceResolutions: [{ status: 'UNRESOLVED' }] }).canCalculate, false);
  assert.deepEqual(
    describeE1aOccurrence({ id: 'o', generation: 1, resourceResolutions: [{ status: 'NEEDS_REVIEW' }] }),
    { label: 'Perlu ditinjau', canCalculate: false },
  );
});
