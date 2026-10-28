import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ahspDiscoveryAnchor,
  ahspDiscoveryEvidence,
  describeAhspAvailability,
  describeAhspBasicPriceGaps,
  hasNoEligibleAhspInUnfilteredSearch,
} from './rabAvailabilityNotice.ts';

test('unlinked AHSP does not claim a failed or unrun search means absent catalog', () => {
  const idle = describeAhspAvailability(false, { kind: 'idle' });
  assert.match(idle?.message ?? '', /belum diperiksa secara menyeluruh/);
  const failed = describeAhspAvailability(false, { kind: 'error' });
  assert.match(failed?.message ?? '', /bukan bukti/);
  const empty = describeAhspAvailability(false, {
    kind: 'ready', query: 'DS 10A 140 cm', fetchedCount: 0, hasNext: false, recommendedCount: 0,
  });
  assert.match(empty?.message ?? '', /Tidak ada AHSP yang muncul/);
  assert.match(empty?.message ?? '', /tidak membuktikan seluruh katalog/);
});

test('a paginated set without a recommendation cannot assert global absence', () => {
  const notice = describeAhspAvailability(false, {
    kind: 'ready', query: '', fetchedCount: 25, hasNext: true, recommendedCount: 0,
  });
  assert.match(notice?.message ?? '', /halaman kandidat lain/);
});

test('recommendation is explicitly not an authorized auto-link', () => {
  const notice = describeAhspAvailability(false, {
    kind: 'ready', query: '', fetchedCount: 2, hasNext: false, recommendedCount: 2,
  });
  assert.match(notice?.message ?? '', /bukan bukti identitas/);
  assert.equal(describeAhspAvailability(true, { kind: 'idle' }), null);
});

test('missing Basic Price is stated from server reason only with precise resource name', () => {
  const notice = describeAhspBasicPriceGaps(true, [
    { rawAhspResourceRef: 'Semen Portland', rawAhspResourceType: 'MATERIAL', status: 'UNRESOLVED', reasonCodes: ['NO_BASIC_PRICE_CANDIDATE'] },
    { rawAhspResourceRef: 'Pasir', rawAhspResourceType: 'MATERIAL', status: 'NEEDS_REVIEW', reasonCodes: ['ONLY_EXPIRED_BASIC_PRICE_CANDIDATES'] },
    { rawAhspResourceRef: 'Pekerja', rawAhspResourceType: 'LABOR', status: 'RESOLVED', reasonCodes: [] },
  ]);
  assert.equal(notice?.missing.length, 2);
  assert.deepEqual(notice?.missing.map(x => x.component), ['Semen Portland', 'Pasir']);
  assert.match(notice?.missing[0].explanation ?? '', /Belum ada Basic Price yang sah/);
  assert.match(notice?.missing[1].explanation ?? '', /kedaluwarsa/);
  assert.match(notice?.message ?? '', /tidak akan mengisi harga dengan Rp0/);
});

test('resource identity ambiguity, unproven unit, or Cost Kernel fail-closed are not mislabelled as missing BP', () => {
  assert.equal(describeAhspBasicPriceGaps(true, [
    { rawAhspResourceRef: 'Batu', status: 'NEEDS_REVIEW', reasonCodes: ['MULTIPLE_CANDIDATES_NEEDS_REVIEW'] },
    { rawAhspResourceRef: 'Kayu 5/7', status: 'UNRESOLVED', reasonCodes: ['SPECIFICATION_UNPROVED'] },
    { rawAhspResourceRef: 'm3', status: 'UNRESOLVED', reasonCodes: ['UNIT_CONVERSION_UNPROVED'] },
  ]), null);
  assert.equal(describeAhspBasicPriceGaps(true, null), null);
  assert.equal(describeAhspBasicPriceGaps(true, undefined), null);
  assert.equal(describeAhspBasicPriceGaps(true, []), null);
  assert.equal(describeAhspBasicPriceGaps(false, [
    { rawAhspResourceRef: 'Semen', status: 'UNRESOLVED', reasonCodes: ['NO_BASIC_PRICE_CANDIDATE'] },
  ]), null);
});

test('a resolved row with a stale reason is not counted as missing price', () => {
  assert.equal(describeAhspBasicPriceGaps(true, [
    { rawAhspResourceRef: 'Semen', status: 'RESOLVED', reasonCodes: ['NO_BASIC_PRICE_CANDIDATE'] },
  ]), null);
});


test('automatic discovery uses a bounded lexical anchor, not an identity/specification claim', () => {
  assert.equal(
    ahspDiscoveryAnchor('Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)'),
    'DS 10A',
  );
  assert.equal(ahspDiscoveryAnchor('Saluran U Pracetak Tipe DS 9'), 'DS 9');
  assert.equal(ahspDiscoveryAnchor('Beton mutu K-250'), 'K-250');
  assert.equal(ahspDiscoveryAnchor(' Pekerjaan Pembersihan '), 'Pekerjaan Pembersihan');
  assert.equal(ahspDiscoveryAnchor(''), null);
  assert.equal(ahspDiscoveryAnchor('U'), null);
  assert.ok((ahspDiscoveryAnchor('x '.repeat(200))?.length ?? 0) <= 120);
});

test('automatic candidate search reads existing API evidence without auto-selecting a version', () => {
  const payload = { items: [
    { id: 'ahsp-1', preference: { recommended: true } },
    { id: 'ahsp-2', preference: { recommended: false } },
  ], hasNext: true };
  const evidence = ahspDiscoveryEvidence(payload, 'Saluran U Pracetak');
  assert.deepEqual(evidence, {
    kind: 'ready', query: 'Saluran U Pracetak',
    fetchedCount: 2, hasNext: true, recommendedCount: 1,
  });
  const notice = describeAhspAvailability(false, evidence!);
  assert.match(notice?.message ?? '', /bukan bukti identitas/);
});

test('malformed or failed candidate responses never masquerade as an empty catalog', () => {
  for (const payload of [null, {}, { items: [], hasNext: 'false' },
    { items: [{ invalid: 'missing-id' }], hasNext: false }]) {
    assert.equal(ahspDiscoveryEvidence(payload, 'DS 10A'), null);
  }
});


test('only verified empty UNFILTERED eligible first page can declare catalogue not ready', () => {
  const empty = { items: [], hasNext: false, query: '', page: 1, limit: 1 };
  assert.equal(hasNoEligibleAhspInUnfilteredSearch(empty), true);
  assert.equal(hasNoEligibleAhspInUnfilteredSearch({ ...empty, query: 'DS 10A' }), false);
  assert.equal(hasNoEligibleAhspInUnfilteredSearch({ ...empty, page: 2 }), false);
  assert.equal(hasNoEligibleAhspInUnfilteredSearch({ ...empty, hasNext: true }), false);
  assert.equal(hasNoEligibleAhspInUnfilteredSearch({ ...empty, items: [{ id: 'any' }] }), false);
  assert.equal(hasNoEligibleAhspInUnfilteredSearch({ items: [], hasNext: false }), false);
  assert.equal(hasNoEligibleAhspInUnfilteredSearch(null), false);
});

test('complete eligible emptiness is a separate honest exception from missing global AHSP records', () => {
  const n = describeAhspAvailability(false, { kind: 'eligible_catalog_empty' });
  assert.equal(n?.title, 'Belum ada AHSP yang dapat digunakan');
  assert.match(n?.message ?? '', /memenuhi syarat/);
  assert.match(n?.message ?? '', /historis/);
  assert.match(n?.message ?? '', /belum dihitung/);
  assert.equal(describeAhspAvailability(true, { kind: 'eligible_catalog_empty' }), null);
});
