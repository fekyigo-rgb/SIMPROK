/**
 * SOFT RE-VERIFICATION — "check this again", never "you may not use this".
 *
 * THE THREE DATES ARE THREE DIFFERENT FACTS, and this file owns exactly one of
 * them:
 *
 *   effectiveDate  the source's own effective-START fact. Owned by the existing
 *                  temporal-provenance law. Nothing here reads or writes it.
 *
 *   validUntil     a HARD validity boundary, and the only one the system
 *                  enforces: `ahsp-resource-resolution.orchestrator.ts` filters
 *                  candidates on `{ OR: [{ validUntil: null }, { validUntil:
 *                  { gte: asOf } }] }`, and `rab-kernel-persistence.service.ts`
 *                  fails a line closed when `validUntil < asOf`. It belongs to
 *                  a source that genuinely states its price stops being valid.
 *                  This file NEVER writes it.
 *
 *   reviewDate     THIS FILE. A SOFT recommendation about freshness, carrying
 *                  no eligibility meaning whatsoever.
 *
 * WHAT THIS FILE DELIBERATELY NO LONGER DOES — AND WHY.
 *
 * An earlier version computed the date itself. It read the ingestion channel,
 * decided that `USER_UPLOAD`/`MOBILE` meant "snapshot" and every other channel
 * meant "live", then added a fixed TWO-YEAR horizon to the source period so a
 * 2024 workbook produced "31 December 2026". Both halves were invented.
 *
 * The two-year figure came from an ILLUSTRATION of what such a date looks like
 * on screen and was implemented as though it were a universal rule. It is not
 * one. No canonical policy in this repository states how long any source stays
 * fresh, so any interval this file chose would be manufactured precision — a
 * number with no authority behind it, printed at a person as if SIMPROK knew.
 *
 * The channel test was the same mistake in another place. Source family,
 * ingestion channel and freshness behaviour are three independent axes: a
 * supplier quotation exported by hand is a snapshot, the same supplier wired
 * system-to-system is not, and a government annual snapshot that arrives
 * through a feed is still an annual snapshot. Collapsing that into "which
 * channel did the bytes arrive through" would have made the wrong call
 * confidently.
 *
 * So SIMPROK does not guess. `reviewDate` is a fact a human states when it
 * applies, it stays null when nobody states it, and null renders as nothing at
 * all rather than as a warning. A recommendation engine may be built later, on
 * evidence; it is not smuggled in here.
 *
 * WHY OVERDUE-NESS IS NOT `freshnessStatus`. The tempting shortcut was to mark
 * an overdue price `EXPIRED`, since `PriceFreshnessStatus` already has that
 * member. It would have been wrong: `ahsp-resource-price-resolution.kernel.ts`
 * reads `price.freshnessStatus === 'EXPIRED'` and, when every compatible
 * candidate carries it, degrades the whole resolution to `NEEDS_REVIEW` with
 * `ONLY_EXPIRED_BASIC_PRICE_CANDIDATES`. Writing that from a passed review date
 * would make an old-but-perfectly-usable survey price stop resolving. So
 * overdue-ness is DERIVED AT READ TIME below, stored nowhere, and reaches no
 * filter.
 *
 * A PRICE PAST ITS REVIEW DATE IS NOT A FALSE PRICE. It is a price whose age is
 * worth a second look. The product says so and then gets out of the way.
 */

export type ReverificationState = 'CURRENT' | 'DUE' | 'NOT_RECOMMENDED';

/**
 * Is this price past the date a human asked for it to be re-checked?
 *
 * DERIVED, NEVER STORED. Returning a value here changes no eligibility, no
 * candidate set and no status column; it only lets a screen say a true thing.
 *
 * `NOT_RECOMMENDED` means nobody stated a date — the ordinary case, not a
 * defect — and must never be rendered as a warning or as a missing fact.
 */
export function reverificationState(
  reviewDate: Date | null,
  now: Date,
): ReverificationState {
  if (reviewDate === null) return 'NOT_RECOMMENDED';
  return now.getTime() >= reviewDate.getTime() ? 'DUE' : 'CURRENT';
}
