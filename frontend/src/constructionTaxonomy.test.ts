import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIDANG,
  JENIS_PEKERJAAN,
  SUBKATEGORI_BY_BIDANG,
  mergeVocabulary,
  subkategoriForBidang,
} from './constructionTaxonomy.ts';

/**
 * ONE shared construction taxonomy (Owner §3/§4/§5). These are knowledge laws,
 * not presentation: they pin the vocabulary content and its context-aware
 * shape, independent of any mockup. The AHSP room, and later BOQ/Basic Price,
 * consume this one module.
 */

test('Bidang exposes the Owner baseline, is de-duplicated, and ends with "Lainnya"', () => {
  for (const baseline of ['Bina Marga', 'Cipta Karya', 'Sumber Daya Air', 'Perumahan & Permukiman', 'Umum']) {
    assert.ok(BIDANG.includes(baseline), `Bidang must include ${baseline}`);
  }
  assert.equal(BIDANG[BIDANG.length - 1], 'Lainnya', '"Lainnya" is always the escape hatch, last');
  assert.equal(new Set(BIDANG).size, BIDANG.length, 'no duplicate Bidang');
  assert.ok(BIDANG.length > 6, 'enriched beyond the 6 baseline entries');
});

test('Subkategori is context-aware: it changes with the selected Bidang', () => {
  const binaMarga = subkategoriForBidang('Bina Marga');
  const sumberDayaAir = subkategoriForBidang('Sumber Daya Air');
  assert.ok(binaMarga.includes('Jalan') && binaMarga.includes('Jembatan'), 'Bina Marga has road/bridge subcategories');
  assert.ok(sumberDayaAir.includes('Bendungan'), 'Sumber Daya Air has water subcategories');
  assert.ok(!sumberDayaAir.includes('Jembatan'), 'water Bidang does not borrow road subcategories');
  assert.notDeepEqual(binaMarga, sumberDayaAir, 'the two Bidang yield different subcategory sets');
});

test('an unknown / unmapped / blank Bidang yields an honest empty subkategori, never a guess', () => {
  // "Bandar Udara & Penerbangan" is a real Bidang the Owner did not enumerate with subcategories.
  assert.deepEqual(subkategoriForBidang('Bandar Udara & Penerbangan'), []);
  assert.deepEqual(subkategoriForBidang('Sesuatu Yang Tidak Dikenal'), []);
  assert.deepEqual(subkategoriForBidang(''), []);
  assert.deepEqual(subkategoriForBidang(null), []);
  assert.deepEqual(subkategoriForBidang(undefined), []);
});

test('Jenis Pekerjaan is available, de-duplicated, and holds work types — not AHSP codes or authority names', () => {
  assert.ok(JENIS_PEKERJAAN.length > 10, 'a usable work-type vocabulary');
  assert.equal(new Set(JENIS_PEKERJAAN).size, JENIS_PEKERJAAN.length, 'no duplicate work types');
  assert.ok(JENIS_PEKERJAAN.includes('Beton') && JENIS_PEKERJAAN.includes('Galian'), 'contains real construction work');
  for (const jenis of JENIS_PEKERJAAN) {
    assert.ok(!/^[A-Z]\.\d/.test(jenis), `"${jenis}" must not read like an AHSP code (e.g. B.13)`);
    assert.ok(!['Bina Marga', 'Cipta Karya', 'Sumber Daya Air'].includes(jenis), `"${jenis}" must not be an authority name`);
  }
});

test('every curated Subkategori list is de-duplicated and belongs to a known Bidang', () => {
  for (const [bidang, subs] of Object.entries(SUBKATEGORI_BY_BIDANG)) {
    assert.ok(BIDANG.includes(bidang), `curated Bidang "${bidang}" must be a known Bidang`);
    assert.ok(subs.length > 0, `curated list for "${bidang}" is non-empty`);
    assert.equal(new Set(subs).size, subs.length, `no duplicate subcategory within "${bidang}"`);
  }
});

test('mergeVocabulary keeps curated order first and never hides a value present in the data', () => {
  const merged = mergeVocabulary(['Jalan', 'Jembatan'], ['Jembatan', 'Gorong-Gorong Khusus', null, '   ']);
  assert.deepEqual(merged.slice(0, 2), ['Jalan', 'Jembatan'], 'curated stays first, in order, de-duplicated');
  assert.ok(merged.includes('Gorong-Gorong Khusus'), 'a data value outside the curated list is preserved, never hidden');
  assert.equal(merged.filter((value) => value === 'Jembatan').length, 1, 'a value in both appears once');
  assert.ok(!merged.includes('') && !merged.includes('   '), 'blank data values are dropped');
});
