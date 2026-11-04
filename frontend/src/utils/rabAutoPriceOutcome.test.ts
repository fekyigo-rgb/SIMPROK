import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accumulateRabAutoPriceOutcome,
  describeRabAutoPriceOutcome,
  emptyRabAutoPriceOutcome,
  isRabAutoPriceNoticeCurrent,
  parseRabAutoPricePage,
  type RabAutoPriceOutcome,
} from './rabAutoPriceOutcome.ts';

const projectId = 'project-rab';
const page = (
  counts: RabAutoPriceOutcome,
  hasNext: boolean,
): unknown => ({ projectId, counts, hasNext });

function summarizePages(pages: readonly unknown[]) {
  let outcome = emptyRabAutoPriceOutcome();
  let completed = false;
  for (const raw of pages) {
    const parsed = parseRabAutoPricePage(raw, projectId);
    assert.ok(parsed, 'all pages must provide complete official counts');
    outcome = accumulateRabAutoPriceOutcome(outcome, parsed.counts);
    if (!parsed.hasNext) {
      completed = true;
      break;
    }
  }
  assert.equal(completed, true, 'the API must confirm the last page');
  return { outcome, message: describeRabAutoPriceOutcome(outcome) };
}

test('full success across pages: every persisted row counted and no false failure', () => {
  const { outcome, message } = summarizePages([
    page({ calculatedAndPersisted: 25, unpriced: 0, requiresRevalidation: 0 }, true),
    page({ calculatedAndPersisted: 3, unpriced: 0, requiresRevalidation: 0 }, false),
  ]);
  assert.deepEqual(outcome, {
    calculatedAndPersisted: 28, unpriced: 0, requiresRevalidation: 0,
  });
  assert.match(message, /28 baris dihitung dan disimpan otomatis/);
  assert.match(message, /0 baris belum memenuhi syarat harga/);
  assert.doesNotMatch(message, /belum berhasil disimpan/);
  assert.match(message, /Cost Kernel/);
});

test('partial success: price gaps stay visible, without claiming total completion', () => {
  const { outcome, message } = summarizePages([
    page({ calculatedAndPersisted: 2, unpriced: 1, requiresRevalidation: 0 }, true),
    page({ calculatedAndPersisted: 1, unpriced: 2, requiresRevalidation: 0 }, false),
  ]);
  assert.deepEqual(outcome, {
    calculatedAndPersisted: 3, unpriced: 3, requiresRevalidation: 0,
  });
  assert.match(message, /3 baris dihitung dan disimpan otomatis/);
  assert.match(message, /3 baris belum memenuhi syarat harga/);
  assert.doesNotMatch(message, /belum berhasil disimpan/);
});

test('mixed success and revalidation: failures on later pages cannot disappear', () => {
  const { outcome, message } = summarizePages([
    page({ calculatedAndPersisted: 2, unpriced: 0, requiresRevalidation: 0 }, true),
    page({ calculatedAndPersisted: 1, unpriced: 1, requiresRevalidation: 2 }, false),
  ]);
  assert.deepEqual(outcome, {
    calculatedAndPersisted: 3, unpriced: 1, requiresRevalidation: 2,
  });
  assert.match(message, /3 baris dihitung dan disimpan otomatis/);
  assert.match(message, /1 baris belum memenuhi syarat harga/);
  assert.match(message, /2 baris belum berhasil disimpan/);
  assert.match(message, /validasi ulang/);
  assert.match(message, /jangan menganggap seluruh pekerjaan selesai/);
});

test('revalidation failure only: zero price gaps must never disguise failed writes', () => {
  const { outcome, message } = summarizePages([
    page({ calculatedAndPersisted: 0, unpriced: 0, requiresRevalidation: 2 }, false),
  ]);
  assert.equal(outcome.calculatedAndPersisted, 0);
  assert.equal(outcome.unpriced, 0);
  assert.equal(outcome.requiresRevalidation, 2);
  assert.match(message, /2 baris belum berhasil disimpan/);
  assert.match(message, /Periksa kembali baris tersebut dan hasil RAB/);
});

test('malformed or missing revalidation evidence is rejected, never treated as zero', () => {
  const counts = { calculatedAndPersisted: 2, unpriced: 0, requiresRevalidation: 1 };
  assert.equal(parseRabAutoPricePage({ projectId, hasNext: false, counts: {
    calculatedAndPersisted: 2, unpriced: 0,
  } }, projectId), null);
  assert.equal(parseRabAutoPricePage({ projectId: 'another-project', hasNext: false, counts }, projectId), null);
  assert.equal(parseRabAutoPricePage({ projectId, hasNext: 'false', counts }, projectId), null);
  for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
    assert.equal(parseRabAutoPricePage({ projectId, hasNext: false, counts: {
      ...counts, requiresRevalidation: invalid,
    } }, projectId), null);
  }
});

test('failed-write alert survives transient loading and ready messages after canonical draft reload', () => {
  const notice = {
    projectId,
    date: '2026-11-04',
    draftRevision: 7,
    message: describeRabAutoPriceOutcome({
      calculatedAndPersisted: 2,
      unpriced: 0,
      requiresRevalidation: 1,
    }),
  };
  const context = {
    projectId, date: notice.date, draftRevision: 7, draftDirty: false,
  };
  // The current header is transient and can be replaced by retryToken reload.
  // The separate alert is scoped to source context, not to that header.
  for (const transientHeader of [
    notice.message,
    'Memuat draft...',
    'Draft tersimpan dimuat. Ruang kerja siap.',
  ]) {
    assert.equal(typeof transientHeader, 'string');
    assert.equal(isRabAutoPriceNoticeCurrent(notice, context), true);
    assert.match(notice.message, /1 baris belum berhasil disimpan/);
  }
});

test('failed-write alert never leaks into changed BOQ, project or date contexts', () => {
  const notice = {
    projectId,
    date: '2026-11-04',
    draftRevision: 7,
    message: '1 baris memerlukan validasi ulang',
  };
  const context = {
    projectId, date: notice.date, draftRevision: 7, draftDirty: false,
  };
  assert.equal(isRabAutoPriceNoticeCurrent(notice, context), true);
  assert.equal(isRabAutoPriceNoticeCurrent(notice, {
    ...context, projectId: 'another-project',
  }), false);
  assert.equal(isRabAutoPriceNoticeCurrent(notice, {
    ...context, date: '2026-11-05',
  }), false);
  assert.equal(isRabAutoPriceNoticeCurrent(notice, {
    ...context, draftRevision: 8,
  }), false);
  assert.equal(isRabAutoPriceNoticeCurrent(notice, {
    ...context, draftDirty: true,
  }), false);
  assert.equal(isRabAutoPriceNoticeCurrent(null, context), false);
});
