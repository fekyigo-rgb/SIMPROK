// BP-UX-FINAL-01 — KESEGARAN, IN THE TWO WORDS A PERSON ACTUALLY NEEDS.
//
// Pure and dependency-light on purpose: this module is imported by node:test
// unit tests, so it must never fetch, never read import.meta, and never call
// `new Date()` of its own — every function that needs "now" is handed it, the
// same discipline `basic-price-reverification.policy.ts` already follows on the
// server.
//
// WHAT THIS MODULE IS, AND WHAT IT REFUSES TO BE.
//
// It is a PROJECTION of facts the backend already sends. It decides nothing:
// not eligibility, not currentness, not precedence, not whether a price may be
// used. Those three questions are answered once, in the database, by
// `buildUsableBasicPriceWhere`, `promotionLineagePrecedenceWhere` and
// `basicPriceCurrentnessWhere` — and a row that reaches this file has already
// passed all three. Re-deciding any of them here would be the duplicated
// frontend law BP-UX-FINAL-01 §28.6 forbids, and it would drift the moment the
// server's rule changed.
//
// So the rule below is a LABEL rule over two facts the projection carries:
// `freshnessStatus` (stored evidence-age) and `reverification` (derived from a
// human-stated `reviewDate`). Both already exist; neither is invented here.
import { formatBackendRupiah } from './rabCostDisplay.ts';
// REUSED, NOT RE-SPELLED (§20). `Verifikasi ulang pada` is already the settled
// wording for this date — chosen deliberately over `Berlaku sampai`, which
// belongs to `validUntil` and means something the system actually enforces.
// Importing it means the two places that mention the date can never drift into
// calling it two different things.
import { REVERIFICATION_LABEL } from './basicPriceExplorerDisplay.ts';

/**
 * The freshness the Explorer shows a human. TWO values, never three.
 *
 * The projection carries THREE `freshnessStatus` members (CURRENT / EXPIRING /
 * EXPIRED) and THREE `reverification` states, and a reader does not need six
 * combinations — they need to know whether to trust this number as it stands or
 * go and look. Owner law (§8, §24) fixes the vocabulary at exactly these two.
 */
export type FreshnessView = 'TERKINI' | 'VERIFIKASI_ULANG';

/**
 * The compact chip wording. `Verifikasi Ulang`, NOT `Perlu Verifikasi Ulang` —
 * the longer form is the sentence, and a chip is not a sentence (§8).
 */
export const FRESHNESS_VIEW_LABELS: Record<FreshnessView, string> = {
  TERKINI: 'Terkini',
  VERIFIKASI_ULANG: 'Verifikasi Ulang',
};

/** The facts this module reads. A structural subset of BasicPriceExplorerItem. */
export interface FreshnessFacts {
  price: string;
  effectiveDate: string;
  validUntil: string | null;
  freshnessStatus: string;
  reviewDate?: string | null;
  reverification?: 'CURRENT' | 'DUE' | 'NOT_RECOMMENDED';
}

/**
 * The three `freshnessStatus` codes the canonical `PriceFreshnessStatus` enum
 * actually defines. Anything else is a value this build has never heard of.
 */
const KNOWN_FRESHNESS_CODES = new Set(['CURRENT', 'EXPIRING', 'EXPIRED']);

/**
 * BP-UX-FINAL-01D §5.3 — WHAT `freshnessStatus` IS, AND WHY A HISTORICAL LENS
 * MAY READ IT.
 *
 * Before using a persisted flag to describe a PAST day, someone has to prove
 * the flag is not secretly a statement about TODAY. Census of the backend:
 *
 *   WRITERS   exactly two, both at row CREATION, both writing the literal
 *             'CURRENT' — `basic-price-private-asset.service.ts` and
 *             `price-submission-review.service.ts`. Plus the schema default,
 *             `@default(CURRENT)`.
 *   UPDATERS  NONE. No service, no script, no migration backfill and no
 *             scheduled job ever changes the column after creation.
 *
 * The private-asset writer says why, in as many words: "FRESHNESS STATUS IS
 * NOT TOUCHED BY RE-VERIFICATION ... Overdue-ness is derived at READ time from
 * `reviewDate` and stored nowhere."
 *
 * SO IT IS AN IMMUTABLE STORED FLAG, NOT AN AGEING ONE. Its value on any past
 * day equals its value today, which is exactly what makes it safe in an AS-OF
 * lens: reading it is not borrowing present-day knowledge, because there is no
 * present-day knowledge in it to borrow. It also means it carries no ageing
 * information whatsoever — every lawfully created row reads CURRENT.
 *
 * THEREFORE ALL TIME-SENSITIVE FRESHNESS IN A HISTORICAL LENS COMES FROM THE
 * TWO FACTS THAT REALLY ARE DATED: `reverification` (derived server-side from
 * `reviewDate` AT the asked-about instant) and `validUntil` (the source's own
 * boundary, compared against the same instant). Neither is re-derived here.
 *
 * And the unknown-code branch below stays conservative in both lenses: a code
 * this build cannot read is the one state where SIMPROK has NOT looked, so it
 * can never print the positive claim `Terkini` — historically or now.
 */

/**
 * WHICH OF THE TWO WORDS THIS PRICE GETS.
 *
 * THREE proven facts move a row to VERIFIKASI_ULANG:
 *
 *   1. A human stated a re-verification date and it has passed
 *      (`reverification === 'DUE'`). Someone who knew this source said "look
 *      again after here", and here has arrived.
 *
 *   2. SIMPROK's own stored evidence-age says the price is near or past the
 *      end of its freshness (`freshnessStatus` EXPIRING / EXPIRED).
 *
 *   3. THE CODE IS ONE THIS BUILD DOES NOT RECOGNISE.
 *
 * REASON 3 REVERSED, AND THE REVERSAL IS THE WHOLE POINT (§G2).
 *
 * This used to fall back to TERKINI, defended as "a display module must not
 * invent a warning out of a value it does not recognise". That reasoning is
 * backwards for a vocabulary of exactly two words. `Terkini` is not a neutral
 * label — it is a POSITIVE CLAIM that SIMPROK has looked and found nothing
 * needing a second look. An unknown code is precisely the state in which
 * SIMPROK has NOT looked, because it cannot read the answer. Printing the
 * positive claim there manufactures confidence out of ignorance.
 *
 * `Verifikasi Ulang` costs a person one glance at the source. `Terkini` over an
 * unread state costs them a decision made on a number nobody checked. With only
 * two words available, the conservative one is the only honest one.
 *
 * NEITHER WORD MEANS THE PRICE IS WRONG, and neither removes it from the
 * Explorer — that is why all three reasons collapse into "check this again"
 * rather than into anything that reads as a refusal.
 */
export function freshnessView(facts: FreshnessFacts): FreshnessView {
  if (facts.reverification === 'DUE') return 'VERIFIKASI_ULANG';
  if (!KNOWN_FRESHNESS_CODES.has(facts.freshnessStatus)) return 'VERIFIKASI_ULANG';
  if (facts.freshnessStatus !== 'CURRENT') return 'VERIFIKASI_ULANG';
  return 'TERKINI';
}

/**
 * HAS THE SOURCE ITSELF SAID THIS PRICE STOPS BEING VALID, AND HAS THAT PASSED?
 *
 * `validUntil` is the ONE hard boundary in this domain — the AHSP resolver
 * filters candidates on it and `rab-kernel-persistence` fails a line closed
 * when it is behind the business date. It is a SOURCE fact, not a SIMPROK
 * judgement, and reading it back is restating what the row already says.
 *
 * It is read here for exactly one reason: so the layer below never promises
 * "masih dapat digunakan" over a price whose own source has already withdrawn
 * that claim. This is not a second eligibility rule — nothing here filters,
 * hides or reorders anything — it only stops SIMPROK making a promise the
 * source did not make.
 */
export function sourceValidityHasLapsed(facts: FreshnessFacts, now: Date): boolean {
  if (!facts.validUntil) return false;
  const until = Date.parse(facts.validUntil);
  if (Number.isNaN(until)) return false;
  return now.getTime() > until;
}

// ── The temporal context every sentence on this screen is spoken in ─────────

/**
 * BP-UX-FINAL-01D GAP-D — ONE CLOCK PER SCREEN, NAMED.
 *
 * The Explorer answers two questions, and until now they could be about
 * different days without saying so:
 *
 *   "which price APPLIED on D"   — the server's applicability filter, at D
 *   "is this price stale"        — computed at wall-clock now
 *
 * A person looking at 2024 was shown a 2024 price wearing a 2026 verdict. So
 * the instant is now carried explicitly, together with WHICH KIND of instant it
 * is — because the two modes do not merely differ in arithmetic, they differ in
 * what SIMPROK is entitled to ask of the reader:
 *
 *   PRESENT  the price is live. "Go and check the source before you decide" is
 *            a real, actionable instruction.
 *   AS_OF    the reader is reconstructing a past state. Telling them to go and
 *            check today's market would answer a question they did not ask, and
 *            would quietly re-present a reconstruction as a live offer.
 *
 * The instant is resolved by the CALLER — this module still never calls
 * `new Date()` — and it is the SAME instant the server used to select the row.
 */
export type TemporalMode = 'PRESENT' | 'AS_OF';

export interface TemporalContext {
  mode: TemporalMode;
  /** The one instant every temporal judgement on this screen is made for. */
  instant: Date;
}

export const presentContext = (now: Date): TemporalContext => ({
  mode: 'PRESENT',
  instant: now,
});

/**
 * The AS-OF lens, built from the exact `YYYY-MM-DD` the person typed and the
 * server was sent. Parsed as UTC midnight — the identical instant
 * `parseDateOnlyUtc` produces on the server — so the screen and the query can
 * never disagree by a timezone.
 *
 * NOT A SECOND PARSER. The server refuses a malformed or impossible date with a
 * 400 and the list shows an honest invalid-filter state, so nothing is rendered
 * for it. This only guarantees a verdict is never computed from `NaN`.
 */
export const asOfContext = (isoDate: string, now: Date): TemporalContext => {
  const parsed = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return presentContext(now);
  return { mode: 'AS_OF', instant: new Date(parsed) };
};

export interface FreshnessMeaning {
  view: FreshnessView;
  label: string;
  /**
   * The FIRST thing a person reads when they open the layer. For
   * VERIFIKASI_ULANG this must lead with usability (§9) — the whole point of
   * the state is that the price still works.
   */
  headline: string;
  /** Why, in one restrained sentence. Never a warning block. */
  body: string;
  /** The specific canonical facts behind the verdict. Empty for TERKINI. */
  reasons: string[];
}

const TERKINI_HEADLINE = 'Harga masih relevan.';
const TERKINI_BODY =
  'Berdasarkan data dan bukti terbaru yang tersedia di SIMPROK, harga ini belum menunjukkan tanda perlu diperiksa ulang.';
/**
 * The SAME verdict, spoken about a past day. It still says the price was fine
 * as of then; it simply stops short of implying anything about today, which the
 * present-tense wording ("data dan bukti terbaru") quietly would.
 */
const TERKINI_HISTORICAL_HEADLINE = 'Pada tanggal ini, harga masih relevan.';
const TERKINI_HISTORICAL_BODY =
  'Menurut catatan SIMPROK, pada tanggal yang ditampilkan harga ini belum menunjukkan tanda perlu diperiksa ulang.';

/**
 * OWNER-FIXED FIRST SENTENCE (§16). The whole point of VERIFIKASI ULANG is that
 * the price still works, so usability leads and the advice follows — never the
 * other way round.
 */
const RECHECK_HEADLINE = 'Harga ini masih dapat digunakan.';
const RECHECK_BODY =
  'Kondisi pasar atau lapangan mungkin telah berubah. Krocek kembali sumber atau kondisi aktual sebelum digunakan untuk keputusan sekarang.';

/**
 * THE HISTORICAL FORM, AND WHY IT IS NOT THE SAME SENTENCE.
 *
 * "Krocek kembali kondisi aktual ... untuk keputusan sekarang" is an
 * instruction about TODAY. Printed over a price the reader deliberately asked
 * to see AS OF a past date, it answers a question they did not ask and quietly
 * re-presents a reconstruction as a live offer. The historical form states the
 * fact about that day and stops — SIMPROK has no field instruction to give
 * about a past state, so it gives none, and says where the present-tense
 * answer lives instead.
 */
const RECHECK_HISTORICAL_HEADLINE =
  'Pada tanggal ini, harga sudah memasuki waktu pemeriksaan ulang.';
const RECHECK_HISTORICAL_BODY =
  'Ini keadaan pada tanggal yang ditampilkan, bukan penilaian atas harga hari ini. Kosongkan filter tanggal untuk melihat keadaan sekarang.';

/**
 * THE ONE CASE WHERE "MASIH DAPAT DIGUNAKAN" WOULD BE A LIE.
 *
 * When the source stated an end date and that date has passed, SIMPROK must
 * not tell a reader the price is still usable — the Cost Kernel will refuse it
 * for exactly that reason, so the screen and the engine would be saying
 * opposite things about the same row. The state stays VERIFIKASI_ULANG (the
 * vocabulary is Owner-locked at two values) and the headline states the
 * source's own boundary instead of a promise SIMPROK cannot keep.
 *
 * IT IS BELT TO THE SERVER'S BRACES, and 01D made it so. Applicability now
 * removes a lapsed row from the list at the very instant this is evaluated at,
 * so one should never reach here. "Should never" is not "cannot", and this
 * guard fails in the safe direction: if applicability ever regressed, the
 * screen would refuse to promise usability rather than promise it confidently.
 */
const LAPSED_HEADLINE = 'Masa berlaku dari sumber sudah lewat.';
const LAPSED_BODY =
  'Sumber menyatakan harga ini berlaku sampai tanggal di bawah. Perbarui dari sumber sebelum dipakai untuk keputusan sekarang.';

export function freshnessMeaning(
  facts: FreshnessFacts,
  context: TemporalContext,
  formatDate: (iso: string) => string,
): FreshnessMeaning {
  const view = freshnessView(facts);
  const label = FRESHNESS_VIEW_LABELS[view];
  const historical = context.mode === 'AS_OF';

  if (view === 'TERKINI') {
    return {
      view,
      label,
      headline: historical ? TERKINI_HISTORICAL_HEADLINE : TERKINI_HEADLINE,
      body: historical ? TERKINI_HISTORICAL_BODY : TERKINI_BODY,
      reasons: [],
    };
  }

  // The SAME instant the row was selected for, never a second clock.
  const lapsed = sourceValidityHasLapsed(facts, context.instant);
  const reasons: string[] = [];

  if (facts.reverification === 'DUE' && facts.reviewDate) {
    reasons.push(`${REVERIFICATION_LABEL} ${formatDate(facts.reviewDate)} sudah lewat.`);
  }
  if (facts.freshnessStatus === 'EXPIRING') {
    reasons.push('Bukti harga ini mendekati akhir masa kesegarannya menurut catatan SIMPROK.');
  }
  if (facts.freshnessStatus === 'EXPIRED') {
    reasons.push('Bukti harga ini sudah melewati masa kesegarannya menurut catatan SIMPROK.');
  }
  if (!KNOWN_FRESHNESS_CODES.has(facts.freshnessStatus)) {
    // Said plainly rather than dressed up. The person is being asked to check
    // because SIMPROK could not read its own record — not because the price is
    // suspect.
    reasons.push(
      'SIMPROK belum dapat membaca catatan kesegaran untuk harga ini, jadi kesegarannya belum dapat dipastikan.',
    );
  }
  if (lapsed && facts.validUntil) {
    reasons.push(`Sumber menyatakan harga ini berlaku sampai ${formatDate(facts.validUntil)}.`);
  }

  if (lapsed) {
    return { view, label, headline: LAPSED_HEADLINE, body: LAPSED_BODY, reasons };
  }

  return {
    view,
    label,
    headline: historical ? RECHECK_HISTORICAL_HEADLINE : RECHECK_HEADLINE,
    body: historical ? RECHECK_HISTORICAL_BODY : RECHECK_BODY,
    reasons,
  };
}

// ── Correction lineage ──────────────────────────────────────────────────────

/**
 * BP-UX-FINAL-01D GAP-A — IT IS CALLED A CORRECTION HISTORY BECAUSE THAT IS
 * WHAT IT IS.
 *
 * The server walks `BasicPrice.supersedesBasicPriceId` and nothing else. That
 * pointer is written only when a human publishes a price as an explicit
 * CORRECTION of an erroneous published one; a genuinely later observation of
 * the same market carries no pointer at all and never appears here. So this
 * data answers "how has this price been CORRECTED", and it cannot answer "what
 * has this resource cost over time".
 *
 * THE OLD LABEL PROMISED THE SECOND. "Riwayat harga" over a one-entry lineage
 * read as "this resource has no earlier price" — an invented absence, which is
 * the same class of untruth as an invented fact. Every heading, every empty
 * state and every error line below now says KOREKSI.
 */
export interface PriceHistoryEntry {
  key: string;
  date: string;
  price: string;
  /** `Saat ini` or `Digantikan`. Nothing else is ever claimed. */
  tag: string;
}

/**
 * `Digantikan` IS ONLY EVER SAID WHEN THE SERVER PROVED A SUCCESSOR. It is not
 * derived here from position in the list, from an older date, or from a
 * different value — a row is superseded because a persisted id says so, and for
 * no other reason.
 *
 * `Saat ini` rather than `Aktif`: this is a position in a lineage, not a
 * lifecycle status. "Aktif" would be a fourth status vocabulary competing with
 * Terkini/Verifikasi Ulang and with the publication axes, for a fact that is
 * simply "this is the one at the end of the chain".
 */
export const PRICE_HISTORY_STATE_LABELS: Record<'CURRENT' | 'SUPERSEDED', string> = {
  CURRENT: 'Saat ini',
  SUPERSEDED: 'Digantikan',
};

/** The server contract this renderer consumes, structurally. */
export interface PersistedCorrectionEntry {
  price: string;
  effectiveDate: string;
  state: 'CURRENT' | 'SUPERSEDED';
}

/**
 * THE HEADING, CHOSEN BY WHETHER THE SERVER READ THE WHOLE CHAIN.
 *
 * `truncated` is computed on the server from an exact fact — the oldest entry
 * it emitted still names a predecessor it could not resolve. When that is true
 * the lineage below is genuinely partial, and a heading that said otherwise
 * would be claiming a completeness nobody proved. Neither heading is ever a
 * claim about the resource's full price history.
 */
export const CORRECTION_HISTORY_LABEL = 'Riwayat Koreksi';
export const CORRECTION_HISTORY_TRUNCATED_LABEL = 'Riwayat Koreksi Terbaru';

export const correctionHistoryLabel = (truncated: boolean): string =>
  truncated ? CORRECTION_HISTORY_TRUNCATED_LABEL : CORRECTION_HISTORY_LABEL;

/**
 * The one restrained line that goes with the truncated heading.
 *
 * Shown ONLY when the server said so. It states the limit and stops — no count
 * of what is missing, because the server cannot know one, and no apology.
 */
export const CORRECTION_HISTORY_PARTIAL_NOTE =
  'Sebagian riwayat koreksi ditampilkan.';

/**
 * Money stays a decimal STRING the whole way — `formatBackendRupiah` does
 * base-10 string grouping, so exactness survives beyond IEEE-754 safe-integer
 * range. No entry here is ever passed through Number()/parseFloat().
 *
 * KEYED BY POSITION, DELIBERATELY (GAP-C). The payload no longer carries a
 * predecessor's `basicPriceId`, because rendering a dated amount never needed
 * one and an internal UUID is not the browser's to hold. The list is
 * server-ordered, append-only and re-rendered whole, so the index is a stable
 * key here in a way it would not be for a reorderable list.
 */
export function correctionHistoryRows(
  entries: readonly PersistedCorrectionEntry[],
  formatDate: (iso: string) => string,
): PriceHistoryEntry[] {
  return entries.map((entry, index) => ({
    key: `koreksi-${index}`,
    date: formatDate(entry.effectiveDate),
    price: formatBackendRupiah(entry.price),
    tag: PRICE_HISTORY_STATE_LABELS[entry.state],
  }));
}

/**
 * THE ONE ENTRY EVERY ROW CAN PROVE WITHOUT A SECOND REQUEST.
 *
 * Shown while the lawful detail read is in flight, so the layer opens with the
 * price's own real date and its own real money rather than with a spinner over
 * an empty box. It is NOT a fallback lineage: it claims a single position and
 * makes no statement about a past, which is exactly what is known at that
 * moment.
 */
export function anchorCorrectionRow(
  facts: FreshnessFacts,
  formatDate: (iso: string) => string,
): PriceHistoryEntry {
  return {
    key: 'anchor',
    date: formatDate(facts.effectiveDate),
    price: formatBackendRupiah(facts.price),
    tag: PRICE_HISTORY_STATE_LABELS.CURRENT,
  };
}

/** Honest copy for the one case where the lineage could not be read at all. */
export const CORRECTION_HISTORY_UNAVAILABLE =
  'Riwayat koreksi belum dapat dimuat. Coba buka kembali sebentar lagi.';

/**
 * THE EMPTY STATE, AND THE SENTENCE IT MUST NOT SAY.
 *
 * It used to read: "Harga ini belum pernah dikoreksi. Tidak ada harga
 * sebelumnya yang tercatat untuk konteks ini." The first sentence is true. The
 * SECOND is a claim about OBSERVATION history that this data cannot support —
 * a resource may have been priced a dozen times and corrected never, and the
 * screen would have declared those dozen observations non-existent.
 *
 * So only the provable half survives, plus a note that says what the absence
 * actually means.
 */
export const NO_CORRECTION_RECORDED =
  'Harga ini belum memiliki koreksi sebelumnya yang tercatat.';
