import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectKategoriOptions,
  projectSubkategoriOptions,
  projectClassificationCreateSelection,
  toggleProjectClassification,
} from './projectIntakeVocabulary.ts';
import {
  emptyIntakeClassification,
  setIntakeClassificationRoot,
  type ProjectClassificationNode,
} from './projectIntakeSelection.ts';

const ROOT = '11111111-1111-4111-8111-111111111111';
const BINA = '22222222-2222-4222-8222-222222222222';
const JEMBATAN = '33333333-3333-4333-8333-333333333333';
const local: ProjectClassificationNode = {
  id: BINA, parentId: ROOT, level: 'KATEGORI', name: 'Bina Marga',
};

test('RAB reuses the canonical AHSP vocabulary, preserving local identity', () => {
  const options = projectKategoriOptions([local], ROOT);
  assert.equal(options.length, 20);
  assert.equal(options.filter((o) => o.name === 'Bina Marga').length, 1);
  assert.equal(options.find((o) => o.name === 'Bina Marga')?.id, BINA);
  assert.ok(options.some((o) => o.name === 'Cipta Karya' && o.id.startsWith('vocab||')));
  assert.ok(options.some((o) => o.name === 'Sumber Daya Air' && o.id.startsWith('vocab||')));
});

test('RAB only materializes vocabulary on explicit create, never sends a synthetic id', () => {
  const choice = projectKategoriOptions([local], ROOT).find((o) => o.name === 'Cipta Karya')!;
  const sub = projectSubkategoriOptions([], choice).find((o) => o.name === 'Bangunan Gedung')!;
  let selection = setIntakeClassificationRoot(emptyIntakeClassification(), { id: ROOT, name: 'Pekerjaan Konstruksi' });
  selection = toggleProjectClassification(selection, { ...choice, level: 'KATEGORI', parentId: ROOT });
  const children = { [choice.id]: { loaded: true, nodes: [sub] } };
  selection = toggleProjectClassification(selection, { ...sub, level: 'SUBKATEGORI', parentId: choice.id });
  const result = projectClassificationCreateSelection(selection, children);
  assert.deepEqual(result.classificationNodeIds, [ROOT]);
  assert.deepEqual(result.classificationVocabularyPaths, [{ kategori: 'Cipta Karya', subkategori: 'Bangunan Gedung' }]);
  assert.equal(result.waitingForChildren, false);
});

test('RAB keeps an already saved custom subcategory without relabeling it as vocabulary', () => {
  const sub: ProjectClassificationNode = { id: JEMBATAN, parentId: BINA, level: 'SUBKATEGORI', name: 'Gorong-Gorong' };
  const category = projectKategoriOptions([local], ROOT).find((o) => o.name === 'Bina Marga')!;
  const list = projectSubkategoriOptions([sub], category);
  assert.ok(list.some((o) => o.id === JEMBATAN && o.name === 'Gorong-Gorong'));
  let selection = setIntakeClassificationRoot(emptyIntakeClassification(), { id: ROOT, name: 'Pekerjaan Konstruksi' });
  selection = toggleProjectClassification(selection, { ...category, level: 'KATEGORI', parentId: ROOT });
  selection = toggleProjectClassification(selection, { ...sub, level: 'SUBKATEGORI', parentId: BINA });
  const result = projectClassificationCreateSelection(selection, { [BINA]: { loaded: true, nodes: list } });
  assert.deepEqual(result.classificationNodeIds, [ROOT, BINA, JEMBATAN]);
  assert.deepEqual(result.classificationVocabularyPaths, []);
});

test('No selected category is a hard stop, and changing root resets pending choices', () => {
  const root = setIntakeClassificationRoot(emptyIntakeClassification(), { id: ROOT, name: 'Pekerjaan Konstruksi' });
  assert.equal(projectClassificationCreateSelection(root, {}).classificationNodeIds, null);
  const choice = projectKategoriOptions([], ROOT)[2];
  const selected = toggleProjectClassification(root, { ...choice, level: 'KATEGORI', parentId: ROOT });
  const changed = setIntakeClassificationRoot(selected, { id: '44444444-4444-4444-8444-444444444444', name: 'Pekerjaan Konstruksi Terintegrasi' });
  assert.deepEqual(changed.picks, []);
  assert.equal(projectClassificationCreateSelection(changed, {}).classificationNodeIds, null);
});
test('mixed existing UUID and virtual categories remain selected together', () => {
  const options = projectKategoriOptions([local], ROOT);
  const virtual = options.find((item) => item.name === 'Cipta Karya')!;
  let selected = setIntakeClassificationRoot(emptyIntakeClassification(), { id: ROOT, name: 'Pekerjaan Konstruksi' });
  selected = toggleProjectClassification(selected, { ...virtual, level: 'KATEGORI', parentId: ROOT });
  selected = toggleProjectClassification(selected, { ...local, level: 'KATEGORI', parentId: ROOT });
  assert.equal(selected.picks.filter((item) => item.level === 'KATEGORI').length, 2);
  const payload = projectClassificationCreateSelection(selected, {
    [local.id]: { loaded: true, nodes: [] },
    [virtual.id]: { loaded: true, nodes: [] },
  });
  assert.deepEqual(payload.classificationNodeIds, [ROOT, BINA]);
  assert.deepEqual(payload.classificationVocabularyPaths, [{ kategori: 'Cipta Karya' }]);
});
