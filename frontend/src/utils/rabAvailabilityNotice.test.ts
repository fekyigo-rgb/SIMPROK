import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAhspAvailability, describeAhspBasicPriceGaps } from './rabAvailabilityNotice.ts';

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
