import assert from 'node:assert/strict';
import test from 'node:test';
import { readableClassificationPaths } from './ahspBaselineVocabulary.ts';

test('AHSP classification displays the proven root once when the full parent chain already includes it', () => {
  const nodes = new Map([
    ['root', { name: 'Pekerjaan Konstruksi', parent: null }],
    ['category', { name: 'Bina Marga', parent: 'root' }],
    ['subcategory', { name: 'Jembatan', parent: 'category' }],
    ['scope', { name: 'Pemeliharaan', parent: 'subcategory' }],
  ]);
  const line = readableClassificationPaths({
    rootName: 'Pekerjaan Konstruksi',
    pendingPaths: [],
    leafIds: ['scope'],
    nameOf: (id) => nodes.get(id)?.name ?? null,
    parentOf: (id) => nodes.get(id)?.parent ?? null,
  });
  assert.deepEqual(line, ['Pekerjaan Konstruksi → Bina Marga → Jembatan → Pemeliharaan']);
});

test('AHSP classification supplies the root once when a legacy parent chain does not contain it', () => {
  const nodes = new Map([
    ['category', { name: 'Bina Marga', parent: null }],
    ['subcategory', { name: 'Jembatan', parent: 'category' }],
    ['scope', { name: 'Pemeliharaan', parent: 'subcategory' }],
  ]);
  assert.deepEqual(readableClassificationPaths({
    rootName: 'Pekerjaan Konstruksi',
    pendingPaths: [],
    leafIds: ['scope'],
    nameOf: (id) => nodes.get(id)?.name ?? null,
    parentOf: (id) => nodes.get(id)?.parent ?? null,
  }), ['Pekerjaan Konstruksi → Bina Marga → Jembatan → Pemeliharaan']);
});
