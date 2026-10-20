import test from 'node:test';
import assert from 'node:assert/strict';
import { specificationInitialFields, specificationFormDecision } from './basicPriceSpecificationForm.ts';

test('Manual supplement is possible without explicit Excel specification columns', () => {
  const initial = specificationInitialFields([], null);
  assert.deepEqual(initial, {});
  assert.deepEqual(specificationFormDecision({ merek: ' Panasonic ', tipe: ' Uji - 01' }, [], null, 'SUPPLEMENT', ''), {
    ok: true, confirmedSpecifications: { merek: 'Panasonic', tipe: 'Uji - 01' },
  });
});

test('Source values and previous human decisions are preserved by supplement', () => {
  const source = [{ label: 'Brand', value: 'Panasonic' }];
  const previous = { facts: { merek: 'Panasonic', tipe: 'T1' }, decisionKind: 'SUPPLEMENT', resultingVersion: 1 };
  const initial = specificationInitialFields(source, previous);
  assert.deepEqual(initial, { merek: 'Panasonic', tipe: 'T1' });
  assert.equal(specificationFormDecision({ merek: 'Rucika', tipe: 'T1' }, source, previous, 'SUPPLEMENT', '').ok, false);
  assert.equal(specificationFormDecision({ merek: 'Panasonic' }, source, previous, 'SUPPLEMENT', '').ok, false);
  assert.equal(specificationFormDecision({ merek: 'Rucika', tipe: 'T1' }, source, previous, 'CORRECT', '').ok, false);
  assert.deepEqual(specificationFormDecision({ merek: 'Rucika', tipe: 'T1' }, source, previous, 'CORRECT', 'Pemeriksaan label asli'), {
    ok: true, confirmedSpecifications: { merek: 'Rucika', tipe: 'T1' }, reason: 'Pemeriksaan label asli',
  });
});

test('Invalid/empty/ambiguous fields fail closed without inventing identity', () => {
  assert.equal(specificationFormDecision({}, [], null, 'SUPPLEMENT', '').ok, false);
  assert.equal(specificationFormDecision({ merek: 'X'.repeat(241) }, [], null, 'SUPPLEMENT', '').ok, false);
  assert.equal(specificationFormDecision({ ukuran: '15–30 cm' }, [{ label: 'Diameter', value: null }], null, 'SUPPLEMENT', '').ok, false);
  assert.equal(specificationFormDecision({ ukuran: '15–30 cm' }, [{ label: 'Diameter', value: null }], null, 'CORRECT', 'Sumber diteliti').ok, true);
});
