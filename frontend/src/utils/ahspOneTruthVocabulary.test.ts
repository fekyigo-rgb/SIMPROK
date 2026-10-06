import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BIDANG, JENIS_PEKERJAAN, SUBKATEGORI_BY_BIDANG } from '../constructionTaxonomy.ts';
import {
  baselineJenisPekerjaanOptions,
  baselineKategoriOptions,
  baselineSubkategoriOptions,
  isVocabularyOptionId,
  pendingPathFromSelection,
  vocabularyOptionName,
  vocabularyOptionParent,
} from './ahspBaselineVocabulary.ts';
import { rowMatchesClassificationFilter } from './ahspListClassification.ts';

test('shared vocabulary keeps the Owner-pinned counts', () => {
  const edges = Object.values(SUBKATEGORI_BY_BIDANG).reduce((sum, names) => sum + names.length, 0);
  const unique = new Set(Object.values(SUBKATEGORI_BY_BIDANG).flat());
  assert.equal(BIDANG.length, 20);
  assert.equal(edges, 99);
  assert.equal(unique.size, 96);
  assert.equal(JENIS_PEKERJAAN.length, 40);
  assert.ok(unique.has('Jalan'));
  assert.ok(SUBKATEGORI_BY_BIDANG['Bina Marga']?.includes('Jalan'));
  assert.ok(SUBKATEGORI_BY_BIDANG['Transportasi & Perkeretaapian']?.includes('Jalan'));
});

test('constructionTaxonomy.ts no longer owns a copied list', () => {
  const source = readFileSync(new URL('../constructionTaxonomy.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('construction-taxonomy.vocabulary.json'));
  assert.equal(source.includes('Bina Marga'), false);
  assert.equal(source.includes('export const BIDANG: readonly string[] = ['), false);
});

test('any Jenis Pengadaan selection offers the 20 Kategori without inventing an edge', () => {
  const first = baselineKategoriOptions([], 'root-a').map((option) => option.name);
  const second = baselineKategoriOptions([], 'root-b').map((option) => option.name);
  assert.deepEqual(first, [...BIDANG]);
  assert.deepEqual(second, [...BIDANG]);
  assert.ok(baselineKategoriOptions([], 'root-a').every((option) => isVocabularyOptionId(option.id)));
});

test('a mapped Kategori shows only its approved Subkategori plus a lawful local addition', () => {
  const options = baselineSubkategoriOptions({
    kategoriName: 'Cipta Karya',
    kategoriOptionId: 'kat-cipta',
    existing: [
      {
        id: 'local-1',
        level: 'SUBKATEGORI',
        name: 'Candidate PR180',
        parentId: 'kat-cipta',
        workspaceId: 'ws-a',
      },
    ],
  });
  const names = options.map((option) => option.name);
  assert.deepEqual(names.slice(0, -1), [...(SUBKATEGORI_BY_BIDANG['Cipta Karya'] ?? [])]);
  assert.equal(names.at(-1), 'Candidate PR180');
  assert.equal(names.includes('Jalan'), SUBKATEGORI_BY_BIDANG['Cipta Karya']?.includes('Jalan') ?? false);
});

test('a kategori with undefined baseline children invents none', () => {
  const options = baselineSubkategoriOptions({
    kategoriName: 'Umum',
    kategoriOptionId: 'kat-umum',
    existing: [],
  });
  assert.deepEqual(options, []);
});

test('Jenis Pekerjaan stays the approved 40 after any Subkategori, plus a local addition', () => {
  const options = baselineJenisPekerjaanOptions({
    subOptionId: 'sub-1',
    existing: [
      {
        id: 'local-jenis',
        level: 'JENIS_PEKERJAAN',
        name: 'Candidate Lokal',
        parentId: 'sub-1',
        workspaceId: 'ws-a',
      },
    ],
  });
  assert.equal(options.length, 41);
  assert.equal(options[0].name, JENIS_PEKERJAAN[0]);
  assert.equal(options.at(-1)?.name, 'Candidate Lokal');
  assert.ok(isVocabularyOptionId(options[0].id));
});

test('a nested vocabulary id keeps its parent path and name', () => {
  const kategori = baselineKategoriOptions([], 'root-pk').find((option) => option.name === 'Cipta Karya');
  assert.ok(kategori);
  const sub = baselineSubkategoriOptions({
    kategoriName: 'Cipta Karya',
    kategoriOptionId: kategori.id,
    existing: [],
  }).find((option) => option.name === 'Bangunan Gedung');
  assert.ok(sub);
  assert.equal(vocabularyOptionParent(sub.id), kategori.id);
  assert.equal(vocabularyOptionName(sub.id), 'Bangunan Gedung');
  const jenis = baselineJenisPekerjaanOptions({ subOptionId: sub.id, existing: [] }).find(
    (option) => option.name === 'Beton',
  );
  assert.ok(jenis);
  assert.equal(
    pendingPathFromSelection({
      jenisId: jenis.id,
      nameOf: (id) => vocabularyOptionName(id),
      parentOf: (id) => vocabularyOptionParent(id),
    })?.kategori,
    'Cipta Karya',
  );
});

test('list classification prefers a canonical path and keeps a legacy row readable', () => {
  assert.equal(
    rowMatchesClassificationFilter(
      {
        classification: 'Pekerjaan Konstruksi',
        fieldCategory: 'Salah',
        classificationPaths: [
          {
            jenisPengadaan: 'Pekerjaan Konstruksi',
            kategori: 'Cipta Karya',
            subkategori: 'Bangunan Gedung',
            jenisPekerjaan: 'Beton',
          },
        ],
      },
      { kategori: 'Cipta Karya', jenisPekerjaan: 'Beton' },
    ),
    true,
  );
  assert.equal(
    rowMatchesClassificationFilter(
      {
        classification: 'Pekerjaan Konstruksi',
        fieldCategory: 'Umum',
        subCategory: null,
        workType: 'Lama',
      },
      { kategori: 'Umum', jenisPekerjaan: 'Lama', legacyWorkType: 'Lama' },
    ),
    true,
  );
});
