import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECTION_HISTORY_LABEL,
  CORRECTION_HISTORY_TRUNCATED_LABEL,
  FRESHNESS_VIEW_LABELS,
  NO_CORRECTION_RECORDED,
  PRICE_HISTORY_STATE_LABELS,
  anchorCorrectionRow,
  asOfContext,
  correctionHistoryLabel,
  correctionHistoryRows,
  freshnessMeaning,
  freshnessView,
  presentContext,
  sourceValidityHasLapsed,
  type FreshnessFacts,
  type PersistedCorrectionEntry,
} from './basicPriceFreshness.ts';

/**
 * KESEGARAN — THE TWO-WORD LAW (BP-UX-FINAL-01 §8, §9, §24).
 *
 * The Owner locked this vocabulary at exactly two values and locked what the
 * second one MEANS: still usable, plus go and check reality. Both halves are
 * easy to break by accident — a third state creeps in from `freshnessStatus`,
 * or a warning sentence quietly turns "check this again" into "this is wrong" —
 * so both are pinned here.
 *
 * BP-UX-FINAL-01D adds the two closures this file is the natural home for:
 *
 *   GAP-D  the SAME instant explains a row that selected it, and a historical
 *          lens never speaks present-tense field advice.
 *   GAP-A  the lineage is called a CORRECTION lineage, and an absent
 *          correction is never rendered as an absent price history.
 */

const NOW = new Date('2026-08-26T00:00:00.000Z');
/** The ordinary lens: no date filter set, so the screen is about right now. */
const PRESENT = presentContext(NOW);
const fmt = (iso: string) => iso.slice(0, 10);

const facts = (over: Partial<FreshnessFacts> = {}): FreshnessFacts => ({
  price: '62500.00',
  effectiveDate: '2026-08-26T00:00:00.000Z',
  validUntil: null,
  freshnessStatus: 'CURRENT',
  reviewDate: null,
  reverification: 'NOT_RECOMMENDED',
  ...over,
});

/* ── The vocabulary itself ─────────────────────────────────────────────── */

test('F-1. exactly two user-facing values exist, and they are the locked words', () => {
  assert.deepEqual(Object.keys(FRESHNESS_VIEW_LABELS).sort(), ['TERKINI', 'VERIFIKASI_ULANG']);
  assert.equal(FRESHNESS_VIEW_LABELS.TERKINI, 'Terkini');
  // §8: the compact chip says `Verifikasi Ulang`, never `Perlu Verifikasi
  // Ulang` — the long form is the sentence, and a chip is not a sentence.
  assert.equal(FRESHNESS_VIEW_LABELS.VERIFIKASI_ULANG, 'Verifikasi Ulang');
});

/* ── Which word a row gets ─────────────────────────────────────────────── */

test('F-2. an ordinary current price is Terkini', () => {
  assert.equal(freshnessView(facts()), 'TERKINI');
});

test('F-3. a price with NO recommended review date is Terkini, not a warning', () => {
  // NOT_RECOMMENDED is the ORDINARY case — nobody stated a date — and must
  // never be rendered as a missing fact or as a reason to doubt the price.
  assert.equal(freshnessView(facts({ reverification: 'NOT_RECOMMENDED', reviewDate: null })), 'TERKINI');
});

test('F-4. a review date that has not arrived yet is still Terkini', () => {
  assert.equal(
    freshnessView(facts({ reviewDate: '2027-01-01T00:00:00.000Z', reverification: 'CURRENT' })),
    'TERKINI',
  );
});

test('F-5. a passed review date asks for re-verification', () => {
  assert.equal(
    freshnessView(facts({ reviewDate: '2026-05-12T00:00:00.000Z', reverification: 'DUE' })),
    'VERIFIKASI_ULANG',
  );
});

test('F-6. stored evidence-age collapses into the same one word', () => {
  // Three backend states, two user-facing words. EXPIRING and EXPIRED are two
  // shades of "the evidence is getting old", and a reader does not act
  // differently on them — both mean go and look.
  assert.equal(freshnessView(facts({ freshnessStatus: 'EXPIRING' })), 'VERIFIKASI_ULANG');
  assert.equal(freshnessView(facts({ freshnessStatus: 'EXPIRED' })), 'VERIFIKASI_ULANG');
});

test('F-7. an unrecognised freshness code fails CONSERVATIVE, never into Terkini', () => {
  // REVERSED IN BP-UX-FINAL-01C §G2, AND THE REVERSAL IS THE POINT.
  //
  // This used to return TERKINI, defended as "a display module must not invent
  // an alarm out of a value it has never heard of". That is backwards for a
  // vocabulary of exactly two words: `Terkini` is not neutral, it is a POSITIVE
  // CLAIM that SIMPROK looked and found nothing needing a second look. An
  // unknown code is exactly the state in which SIMPROK could NOT look.
  //
  // `Verifikasi Ulang` costs one glance at the source. `Terkini` over an unread
  // state costs a decision made on a number nobody checked.
  assert.equal(
    freshnessView(facts({ freshnessStatus: 'SOMETHING_NEW' })),
    'VERIFIKASI_ULANG',
  );
  assert.equal(freshnessView(facts({ freshnessStatus: '' })), 'VERIFIKASI_ULANG');
});

test('F-7b. the unknown state SAYS it is unknown, and does not blame the price', () => {
  const meaning = freshnessMeaning(
    facts({ freshnessStatus: 'SOMETHING_NEW' }),
    PRESENT,
    fmt,
  );
  // Still usable — an unreadable record is SIMPROK's own gap, not a defect in
  // the price, so the locked first sentence still leads.
  assert.equal(meaning.headline, 'Harga ini masih dapat digunakan.');
  assert.ok(
    meaning.reasons.some((reason) =>
      /belum dapat membaca catatan kesegaran/u.test(reason),
    ),
    'the reason must name SIMPROK own gap, not the price',
  );
});

/* ── What the layer SAYS, which is the half that can lie ───────────────── */

test('F-8. Verifikasi Ulang leads with usability — the locked first sentence', () => {
  const meaning = freshnessMeaning(
    facts({ reviewDate: '2026-05-12T00:00:00.000Z', reverification: 'DUE' }),
    PRESENT,
    fmt,
  );
  assert.equal(meaning.view, 'VERIFIKASI_ULANG');
  // §9: the FIRST message must say the price still works. Everything else in
  // this state is advice about reality, not a withdrawal of permission.
  assert.equal(meaning.headline, 'Harga ini masih dapat digunakan.');
  assert.match(meaning.body, /Krocek kembali/u);
});

test('F-9. no re-verification sentence is ever worded as a rejection', () => {
  const meaning = freshnessMeaning(facts({ freshnessStatus: 'EXPIRED' }), PRESENT, fmt);
  const whole = `${meaning.headline} ${meaning.body} ${meaning.reasons.join(' ')}`;
  for (const forbidden of [/ditolak/iu, /tidak boleh digunakan/iu, /tidak valid/iu, /salah/iu]) {
    assert.doesNotMatch(whole, forbidden, `re-verification must not read as rejection: ${whole}`);
  }
});

test('F-10. the reason names the fact that produced the verdict', () => {
  const meaning = freshnessMeaning(
    facts({ reviewDate: '2026-05-12T00:00:00.000Z', reverification: 'DUE' }),
    PRESENT,
    fmt,
  );
  // Reuses the settled wording for this date rather than inventing a second
  // name for it — see REVERIFICATION_LABEL.
  assert.ok(meaning.reasons.some((reason) => reason.includes('Verifikasi ulang pada 2026-05-12')));
});

test('F-11. Terkini explains itself and accuses nothing', () => {
  const meaning = freshnessMeaning(facts(), PRESENT, fmt);
  assert.equal(meaning.view, 'TERKINI');
  assert.equal(meaning.reasons.length, 0, 'a current price has no reason to justify');
  assert.match(meaning.body, /data dan bukti terbaru/u);
});

/* ── The one case where "still usable" would be a false promise ─────────── */

test('F-12. a lapsed source validity is detected from the row itself', () => {
  assert.equal(sourceValidityHasLapsed(facts({ validUntil: '2026-01-01T00:00:00.000Z' }), NOW), true);
  assert.equal(sourceValidityHasLapsed(facts({ validUntil: '2027-01-01T00:00:00.000Z' }), NOW), false);
  // The ordinary case: no source stated a boundary at all.
  assert.equal(sourceValidityHasLapsed(facts({ validUntil: null }), NOW), false);
  // A value that cannot be parsed proves nothing, so it claims nothing.
  assert.equal(sourceValidityHasLapsed(facts({ validUntil: 'not-a-date' }), NOW), false);
});

test('F-13. SIMPROK does not promise usability the SOURCE has withdrawn', () => {
  const meaning = freshnessMeaning(
    facts({ validUntil: '2026-01-01T00:00:00.000Z', freshnessStatus: 'EXPIRED' }),
    PRESENT,
    fmt,
  );
  // The chip vocabulary is Owner-locked at two values, so the STATE does not
  // change — but the headline must not say "masih dapat digunakan" over a
  // price the Cost Kernel will refuse for exactly this reason. The screen and
  // the engine have to tell the same story.
  assert.equal(meaning.view, 'VERIFIKASI_ULANG');
  assert.notEqual(meaning.headline, 'Harga ini masih dapat digunakan.');
  assert.match(meaning.headline, /Masa berlaku dari sumber sudah lewat/u);
  assert.ok(meaning.reasons.some((reason) => reason.includes('berlaku sampai 2026-01-01')));
});

/* ── History ───────────────────────────────────────────────────────────── */

/**
 * NO ID, AND THAT IS THE CONTRACT (GAP-C). The server stopped sending a
 * predecessor's `basicPriceId` — a dated amount renders without one — so this
 * fixture cannot supply one either, and the renderer must key by position.
 */
const persisted = (
  price: string,
  effectiveDate: string,
  state: 'CURRENT' | 'SUPERSEDED',
): PersistedCorrectionEntry => ({ price, effectiveDate, state });

test('F-14. the timeline renders the SERVER’s entries, in the SERVER’s order', () => {
  // BP-UX-FINAL-01C GAP-D — this used to be one synthetic row plus a sentence
  // saying the screen could not read the past. It can now: exact
  // `supersedesBasicPriceId` lineage, projected by GET /basic-prices/:id/detail.
  const rows = correctionHistoryRows(
    [
      persisted('62500.00', '2026-08-26T00:00:00.000Z', 'CURRENT'),
      persisted('61000.00', '2026-05-12T00:00:00.000Z', 'SUPERSEDED'),
      persisted('59500.00', '2026-01-10T00:00:00.000Z', 'SUPERSEDED'),
    ],
    fmt,
  );

  assert.deepEqual(
    rows.map((row) => [row.date, row.price, row.tag]),
    [
      ['2026-08-26', 'Rp 62.500,00', 'Saat ini'],
      ['2026-05-12', 'Rp 61.000,00', 'Digantikan'],
      ['2026-01-10', 'Rp 59.500,00', 'Digantikan'],
    ],
  );
});

test('F-14b. the two timeline words are the only ones ever printed', () => {
  // "Saat ini" is a POSITION in a timeline, not a lifecycle status. "Aktif"
  // would be a fourth status vocabulary competing with Terkini/Verifikasi Ulang
  // and with the publication axes, for a fact that is simply "this is the one
  // at the end of the chain".
  assert.deepEqual(Object.keys(PRICE_HISTORY_STATE_LABELS).sort(), [
    'CURRENT',
    'SUPERSEDED',
  ]);
  assert.equal(PRICE_HISTORY_STATE_LABELS.CURRENT, 'Saat ini');
  assert.equal(PRICE_HISTORY_STATE_LABELS.SUPERSEDED, 'Digantikan');
});

test('F-14c. `Digantikan` is only ever said when the server said it', () => {
  // Never derived here from list position, an older date, or a different
  // value. A row is superseded because a persisted id names it, and for no
  // other reason.
  const rows = correctionHistoryRows(
    [
      persisted('59500.00', '2026-01-10T00:00:00.000Z', 'CURRENT'),
      persisted('61000.00', '2026-05-12T00:00:00.000Z', 'CURRENT'),
    ],
    fmt,
  );
  assert.deepEqual(
    rows.map((row) => row.tag),
    ['Saat ini', 'Saat ini'],
  );
});

test('F-15. while the read is in flight the layer shows only what the ROW proves', () => {
  // Its own real date and its own real money — not a spinner over an empty box,
  // and not a guessed past.
  const anchor = anchorCorrectionRow(facts(), fmt);
  assert.equal(anchor.date, '2026-08-26');
  assert.equal(anchor.tag, 'Saat ini');
  // Money stays a decimal string the whole way and is grouped by the ONE shared
  // money formatter, never re-spelled and never passed through Number().
  assert.equal(anchor.price, 'Rp 62.500,00');
});

test('F-15b. a one-entry lineage is a real answer, not an empty one', () => {
  const rows = correctionHistoryRows(
    [persisted('62500.00', '2026-08-26T00:00:00.000Z', 'CURRENT')],
    fmt,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tag, 'Saat ini');
});

/* ── 01D GAP-C — no identifier ever reaches the rendered row ────────────── */

test('T-01. rendered rows carry no identifier at all, only what a person reads', () => {
  const rows = correctionHistoryRows(
    [
      persisted('62500.00', '2026-08-26T00:00:00.000Z', 'CURRENT'),
      persisted('61000.00', '2026-05-12T00:00:00.000Z', 'SUPERSEDED'),
    ],
    fmt,
  );
  // Keys are positional, so nothing here can carry a leaked UUID even by
  // accident — the list is server-ordered, append-only and re-rendered whole.
  assert.deepEqual(
    rows.map((row) => row.key),
    ['koreksi-0', 'koreksi-1'],
  );
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['date', 'key', 'price', 'tag']);
  }
});

/* ── 01D GAP-A — the lineage is named for what it is ────────────────────── */

test('T-02. an untruncated lineage is "Riwayat Koreksi"', () => {
  assert.equal(correctionHistoryLabel(false), CORRECTION_HISTORY_LABEL);
  assert.equal(CORRECTION_HISTORY_LABEL, 'Riwayat Koreksi');
});

test('T-03. a BOUNDED lineage never wears the unbounded heading', () => {
  // The server proved it stopped short. A heading that said otherwise would be
  // claiming a completeness nobody established.
  assert.equal(correctionHistoryLabel(true), CORRECTION_HISTORY_TRUNCATED_LABEL);
  assert.equal(CORRECTION_HISTORY_TRUNCATED_LABEL, 'Riwayat Koreksi Terbaru');
});

test('T-04. no user-facing string claims a complete PRICE history', () => {
  // The vocabulary itself is the guard. `supersedesBasicPriceId` records
  // corrections; a heading promising "riwayat harga" would promise the set of
  // OBSERVATIONS, which this data cannot deliver.
  const strings = [
    CORRECTION_HISTORY_LABEL,
    CORRECTION_HISTORY_TRUNCATED_LABEL,
    NO_CORRECTION_RECORDED,
  ];
  for (const text of strings) {
    assert.match(text, /[Kk]oreksi/u, `must name corrections: ${text}`);
    assert.doesNotMatch(text, /riwayat harga/iu, `must not promise price history: ${text}`);
    assert.doesNotMatch(text, /seluruh|lengkap/iu, `must not claim completeness: ${text}`);
  }
});

test('T-05. the empty state never says "no earlier price exists"', () => {
  // The deleted sentence: "Tidak ada harga sebelumnya yang tercatat untuk
  // konteks ini." A resource may have been priced a dozen times and corrected
  // never; that sentence declared those dozen observations non-existent.
  assert.equal(
    NO_CORRECTION_RECORDED,
    'Harga ini belum memiliki koreksi sebelumnya yang tercatat.',
  );
  assert.doesNotMatch(NO_CORRECTION_RECORDED, /harga sebelumnya/iu);
});

/* ── 01D GAP-D — one clock, and the tense that goes with it ─────────────── */

test('T-06. an AS-OF lens judges validity at the ASKED-ABOUT day, not today', () => {
  const historical = asOfContext('2025-06-01', NOW);
  assert.equal(historical.mode, 'AS_OF');
  assert.equal(historical.instant.toISOString(), '2025-06-01T00:00:00.000Z');

  // A source boundary of 1 Jan 2026: already past at NOW, not yet reached on
  // the day being asked about. One row, two honest answers, one per lens.
  const lapsing = facts({ validUntil: '2026-01-01T00:00:00.000Z' });
  assert.equal(sourceValidityHasLapsed(lapsing, PRESENT.instant), true);
  assert.equal(sourceValidityHasLapsed(lapsing, historical.instant), false);
});

test('T-07. an absent date means PRESENT — the same law the server states', () => {
  assert.equal(presentContext(NOW).mode, 'PRESENT');
  assert.equal(presentContext(NOW).instant, NOW);
  // A malformed value is refused by the server with a 400 and no rows are
  // rendered; this only guarantees a verdict is never computed from NaN.
  assert.equal(asOfContext('bukan-tanggal', NOW).mode, 'PRESENT');
  assert.equal(Number.isNaN(asOfContext('bukan-tanggal', NOW).instant.getTime()), false);
});

test('T-08. present-tense field advice is NEVER given about a past day', () => {
  const stale = facts({ reviewDate: '2025-01-01T00:00:00.000Z', reverification: 'DUE' });
  const historical = freshnessMeaning(stale, asOfContext('2025-06-01', NOW), fmt);

  assert.equal(historical.view, 'VERIFIKASI_ULANG');
  // "Krocek kembali ... untuk keputusan sekarang" answers a question the
  // reader did not ask and re-presents a reconstruction as a live offer.
  assert.doesNotMatch(historical.body, /Krocek kembali/u);
  assert.doesNotMatch(historical.body, /keputusan sekarang/u);
  assert.match(historical.headline, /Pada tanggal ini/u);
  // The verdict itself is unchanged — only the tense it is spoken in.
  assert.ok(historical.reasons.some((reason) => reason.includes('Verifikasi ulang pada')));
});

test('T-09. the PRESENT wording keeps its Owner-locked first sentence', () => {
  // §16 — this exact sentence is fixed. The historical branch must not have
  // been achieved by softening the live one.
  const stale = facts({ reviewDate: '2026-05-12T00:00:00.000Z', reverification: 'DUE' });
  const present = freshnessMeaning(stale, PRESENT, fmt);

  assert.equal(present.headline, 'Harga ini masih dapat digunakan.');
  assert.match(present.body, /Krocek kembali/u);
});

test('T-10. Terkini in a historical lens does not vouch for today', () => {
  const historical = freshnessMeaning(facts(), asOfContext('2025-06-01', NOW), fmt);

  assert.equal(historical.view, 'TERKINI');
  assert.match(historical.headline, /Pada tanggal ini/u);
  // The present-tense claim ("data dan bukti terbaru") would say SIMPROK has
  // looked at TODAY and found nothing, which it has not been asked to do.
  assert.doesNotMatch(historical.body, /data dan bukti terbaru/u);
});

test('TEMP-07. an unreadable freshness code never becomes Terkini, in EITHER lens', () => {
  // `Terkini` is a POSITIVE CLAIM that SIMPROK looked and found nothing needing
  // a second look. An unrecognised code is precisely the state in which SIMPROK
  // could NOT look — and a historical lens must not soften that into confidence
  // just because the day being asked about has already passed.
  const unreadable = facts({ freshnessStatus: 'SOMETHING_NEW' });
  for (const context of [PRESENT, asOfContext('2025-06-01', NOW)]) {
    const meaning = freshnessMeaning(unreadable, context, fmt);
    assert.equal(meaning.view, 'VERIFIKASI_ULANG');
    assert.notEqual(meaning.label, 'Terkini');
    assert.ok(
      meaning.reasons.some((reason) =>
        /belum dapat membaca catatan kesegaran/u.test(reason),
      ),
      'the reason must name SIMPROK own gap in both lenses',
    );
  }
});

test('TEMP-07. the stored freshness flag is IMMUTABLE, so a past lens may read it', () => {
  // Census (backend): two writers, both at row CREATION, both writing the
  // literal 'CURRENT'; zero updaters, zero recompute jobs, zero backfills. So
  // the flag's value on a past day equals its value today — reading it in an
  // AS-OF lens borrows no present-day knowledge, because there is none in it.
  //
  // Which also means it carries no AGEING information: everything genuinely
  // time-sensitive must come from `reverification` (dated server-side at the
  // asked-about instant) or `validUntil`. This pins that split.
  const stored = facts({ freshnessStatus: 'CURRENT' });
  const historical = asOfContext('2025-06-01', NOW);

  // Same stored flag, same verdict — the flag itself is lens-independent.
  assert.equal(freshnessView(stored), 'TERKINI');
  assert.equal(
    freshnessView({ ...stored, reverification: 'NOT_RECOMMENDED' }),
    'TERKINI',
  );
  // ...and the lens only changes the WORDING, never the verdict.
  assert.equal(freshnessMeaning(stored, historical, fmt).view, 'TERKINI');
  assert.equal(freshnessMeaning(stored, PRESENT, fmt).view, 'TERKINI');

  // The dated fact IS what moves the verdict, and the server dates it.
  assert.equal(
    freshnessView({ ...stored, reverification: 'DUE' }),
    'VERIFIKASI_ULANG',
  );
});

test('T-11. a hard source boundary is never softened by the historical tense', () => {
  // T7 — a lapsed price must never be answered with a gentler sentence just
  // because the reader is looking backwards. The source boundary wins in both
  // lenses; only rows the boundary has NOT passed get the tense treatment.
  const lapsed = facts({ validUntil: '2024-01-01T00:00:00.000Z', freshnessStatus: 'EXPIRED' });
  for (const context of [PRESENT, asOfContext('2025-06-01', NOW)]) {
    const meaning = freshnessMeaning(lapsed, context, fmt);
    assert.equal(meaning.headline, 'Masa berlaku dari sumber sudah lewat.');
    assert.notEqual(meaning.headline, 'Harga ini masih dapat digunakan.');
  }
});
