import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSameness, identicalAggregateLine, SAMENESS_COPY } from './ahspSamenessDisplay.ts';

/**
 * The sameness view is what the human reads in Import Review. It must speak
 * plain Indonesian, never leak an id/verdict token, and offer ONLY the decisions
 * the identity law physically permits.
 */

test('DISTINCT or absent yields null — nothing to decide, the list renders unchanged', () => {
  assert.equal(describeSameness(undefined), null);
  assert.equal(describeSameness(null), null);
  assert.equal(describeSameness({ identityVerdict: 'DISTINCT' }), null);
  assert.equal(describeSameness({}), null);
});

test('IDENTICAL (live) offers "use existing" and NEVER keep-separate (unique key bars it)', () => {
  const view = describeSameness({
    identityVerdict: 'IDENTICAL',
    identityMatches: [{ ahspId: 'a1', workType: 'Galian', methodName: 'Galian biasa', code: 'B.3' }],
  });
  assert.ok(view);
  assert.equal(view.verdict, 'IDENTICAL');
  assert.equal(view.title, SAMENESS_COPY.IDENTICAL_TITLE);
  assert.equal(view.canUseExisting, true);
  assert.equal(view.canKeepSeparate, false);
  assert.equal(view.refs[0].openHref, '/ahsp/a1');
  assert.equal(view.refs[0].title, 'Galian — Galian biasa');
  assert.equal(view.refs[0].detail, 'Kode B.3');
});

test('IDENTICAL (soft-deleted) can be neither used nor kept separate — only skipped, with a note', () => {
  const view = describeSameness({
    identityVerdict: 'IDENTICAL',
    identityMatches: [{ ahspId: 'a1', workType: 'Galian', methodName: 'Galian biasa', deleted: true }],
  });
  assert.ok(view);
  assert.equal(view.canUseExisting, false);
  assert.equal(view.canKeepSeparate, false);
  // The reader is told the match was deleted...
  assert.equal(view.guidance, SAMENESS_COPY.IDENTICAL_DELETED_GUIDANCE);
  assert.ok(view.guidance.includes('telah dihapus'));
  // ...and the copy names NO action, because none is available on this path.
  assert.ok(!view.guidance.includes('Gunakan AHSP yang sudah ada'));
  assert.ok(!view.guidance.includes('atau lewati'));
});

test('POSSIBLY offers both "use existing" and "keep separate" — the human decides', () => {
  const view = describeSameness({
    identityVerdict: 'POSSIBLY_IDENTICAL',
    identityMatches: [{ ahspId: 'a1', workType: 'Galian', methodName: 'Galian biasa' }],
  });
  assert.ok(view);
  assert.equal(view.verdict, 'POSSIBLY_IDENTICAL');
  assert.equal(view.title, SAMENESS_COPY.POSSIBLY_TITLE);
  assert.equal(view.canUseExisting, true);
  assert.equal(view.canKeepSeparate, true);
});

test('candidate references are capped at 4', () => {
  const matches = Array.from({ length: 8 }, (_, i) => ({ ahspId: 'a' + i, workType: 'W', methodName: 'M' }));
  const view = describeSameness({ identityVerdict: 'POSSIBLY_IDENTICAL', identityMatches: matches });
  assert.equal(view?.refs.length, 4);
});

test('candidates beyond the cap are COUNTED, never silently hidden (the guidance asks to compare)', () => {
  const matches = Array.from({ length: 7 }, (_, i) => ({ ahspId: 'a' + i, workType: 'W', methodName: 'M' }));
  const view = describeSameness({ identityVerdict: 'POSSIBLY_IDENTICAL', identityMatches: matches });
  assert.ok(view);
  assert.equal(view.refs.length, 4);
  assert.equal(view.hiddenRefCount, 3);
  // one candidate => nothing hidden
  const single = describeSameness({
    identityVerdict: 'POSSIBLY_IDENTICAL',
    identityMatches: [{ ahspId: 'a1', workType: 'W', methodName: 'M' }],
  });
  assert.equal(single?.hiddenRefCount, 0);
});

test('the ahspId appears ONLY in the href, never in any rendered text', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const view = describeSameness({
    identityVerdict: 'IDENTICAL',
    identityMatches: [{ ahspId: id, workType: 'Galian', methodName: 'Galian biasa' }],
  });
  assert.ok(view);
  const visible = [view.title, view.guidance, ...view.refs.map((r) => r.title), ...view.refs.map((r) => r.detail)].join(' ');
  assert.ok(!visible.includes(id), 'no id in visible text');
  assert.ok(view.refs[0].openHref.includes(id), 'id lives only in the door href');
});

test('POSSIBLY with MORE THAN ONE candidate withholds "use existing" — SIMPROK never guesses which', () => {
  const view = describeSameness({
    identityVerdict: 'POSSIBLY_IDENTICAL',
    identityMatches: [
      { ahspId: 'a1', workType: 'Galian', methodName: 'Galian biasa' },
      { ahspId: 'a2', workType: 'Galian', methodName: 'Galian Biasa' },
    ],
  });
  assert.ok(view);
  // The decision carries no candidate identity, so adopting "the first one" would
  // be a silent, arbitrary choice. The human keeps control instead.
  assert.equal(view.canUseExisting, false);
  assert.equal(view.canKeepSeparate, true);
  assert.equal(view.guidance, SAMENESS_COPY.POSSIBLY_GUIDANCE_MANY);
  assert.equal(view.refs.length, 2);
});

test('POSSIBLY with exactly ONE candidate still offers "use existing" (unambiguous)', () => {
  const view = describeSameness({
    identityVerdict: 'POSSIBLY_IDENTICAL',
    identityMatches: [{ ahspId: 'a1', workType: 'Galian', methodName: 'Galian biasa' }],
  });
  assert.ok(view);
  assert.equal(view.canUseExisting, true);
  assert.equal(view.guidance, SAMENESS_COPY.POSSIBLY_GUIDANCE);
});

test('many identical AHSPs are spoken in ONE line, not repeated per row (no user fatigue)', () => {
  assert.equal(identicalAggregateLine(3), '3 AHSP sudah ada di SIMPROK dan tidak akan disimpan dua kali.');
  assert.equal(identicalAggregateLine(1), '1 AHSP sudah ada di SIMPROK dan tidak akan disimpan dua kali.');
  // Plain Indonesian only — no verdict token, no id, no database word.
  const line = identicalAggregateLine(12);
  for (const leak of ['IDENTICAL', 'POSSIBLY', 'uuid', 'unique', 'DUPLICATE']) {
    assert.ok(!line.includes(leak), 'must not leak ' + leak);
  }
});

test('a missing code yields no "Kode" detail (honest — the source stated none)', () => {
  const view = describeSameness({
    identityVerdict: 'POSSIBLY_IDENTICAL',
    identityMatches: [{ ahspId: 'a1', workType: 'W', methodName: 'M', code: null }],
  });
  assert.equal(view?.refs[0].detail, '');
});
