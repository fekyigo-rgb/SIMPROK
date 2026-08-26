import { Prisma } from '@prisma/client';

export const BASIC_PRICE_CURRENTNESS_VERSION =
  'BPCORR01B_BASIC_PRICE_CURRENTNESS_V2';

/**
 * BP-CORR-01B — THE ONE PLACE THAT ANSWERS "IS THIS ROW STILL THE TRUTH NOW".
 *
 * SIMPROK keeps three questions apart, and this file owns exactly the third:
 *
 *   ELIGIBILITY   (buildUsableBasicPriceWhere)      MAY this workspace lawfully
 *                                                   use this row. A permission
 *                                                   question.
 *   PRECEDENCE    (promotionLineagePrecedenceWhere) among lawful rows, is this
 *                                                   one merely a copy of another
 *                                                   the caller can already see.
 *                                                   A redundancy question.
 *   CURRENTNESS   (here)                            among lawful rows, has this
 *                                                   one stopped being the answer.
 *                                                   A lifecycle question.
 *
 * IT GREW FROM ONE RULE TO THREE, AND DELIBERATELY STAYED ONE FUNCTION.
 * BP-CORR-01 shipped this file asking a single question — "was I replaced". Two
 * more ways for a row to stop being the answer are now proven, and each could
 * have been given its own helper composed at each call site. That would have
 * been three chances for a consumer to remember two of them, and the first
 * consumer to forget one would silently serve corrected-away money. One
 * function, one composition, every consumer gets all of it or none of it.
 *
 * THE THREE REASONS A LAWFUL ROW IS NOT CURRENT:
 *
 *   1. IT WAS REPLACED — a human published a correction naming it.
 *   2. IT WAS WITHDRAWN — a human recorded that it should no longer be offered,
 *      with no replacement (BP-CORR-01B GAP B).
 *   3. IT RESTATES SOMETHING THAT IS NO LONGER CURRENT — it is a promoted
 *      shared copy, and the origin it copied has itself been replaced or
 *      withdrawn (BP-CORR-01B GAP A).
 *
 * REASON 3 IS THE ONE THAT IS EASY TO GET WRONG. A shared descendant is never
 * itself superseded — the correction lifecycle refuses a shared predecessor —
 * so a rule that only asks "was I replaced" leaves it standing forever. But
 * `promotedFromBasicPriceId` says, in the database, that this row is a COPY of
 * that one: it carries the origin's money and decided nothing of its own. Once
 * the origin stops being current, the copy is restating a truth SIMPROK has
 * already replaced, and offering it to other tenants spreads exactly the number
 * that was corrected away.
 *
 * NOTHING HERE MUTATES, HIDES OR DELETES ANYTHING. Every row this fragment
 * removes from an OFFER is still lawful, still stored, still readable by id,
 * and still spendable by a calculation that already selected it. History stays
 * rich; only the answer to "what does this cost now" changes.
 *
 * EXACT LINEAGE ONLY. Never same-value, never same-resource, never
 * same-effective-date, never a similar name. A row is suppressed only when a
 * persisted id says so — either a successor naming it, an audit row naming it,
 * or its own `promotedFromBasicPriceId`.
 *
 * IT CAN ONLY EVER REMOVE. Three keys, no `OR`, no `AND`, no `NOT` at the top
 * level, so it composes beside eligibility, precedence and a caller's own
 * scalar filters without any of them clobbering another. It never widens a
 * result set, so it can never become a second route to a price eligibility
 * refused.
 */

/**
 * BP-CORR-01B GAP B — WITHDRAWAL, EXPRESSED WITH NO NEW SCHEMA.
 *
 * `BasicPricePublicationAudit` was already the append-only governance record of
 * publication-lifecycle decisions taken about a published price: it names the
 * price, the human, the reason and the moment, its actor FK is RESTRICT so the
 * record cannot be orphaned, and BP-CORR-01 had already established the pattern
 * of a second action verb on it (`SUPERSEDED`). A withdrawal is the same kind
 * of fact, so it is written as the same kind of row.
 *
 * WHY NOT THE FIELDS THAT LOOK CLOSER. `validUntil` is a SOURCE fact — "the
 * source states this price stops being valid on date D" — and a withdrawal is a
 * different claim entirely, made by a different party, at a different time;
 * writing it would also mutate a published economic fact, which is the one
 * thing this whole gate exists to prevent. `freshnessStatus = EXPIRED` is
 * evidence only, and the AHSP kernel already reads it to mean "every candidate
 * is stale, ask a human" — writing it here would make an old-but-usable price
 * stop resolving for the wrong reason. `status` / `verificationStatus` are the
 * publication axes, and moving a published row off them would break both the
 * promoted-row and the supersession-successor CHECK constraints, and would lie.
 */
export const WITHDRAWN_PUBLICATION_AUDIT_ACTION = 'WITHDRAWN';

/**
 * WHEN A WITHDRAWAL IS IN FORCE — AND WHY THIS IS NOT `createdAt`.
 *
 * The first version of this file compared `asOf` against the audit row's
 * `createdAt` and defended it as "SIMPROK does not backdate". That defence only
 * covered the case where the source states nothing; it silently foreclosed the
 * case where the source DOES state something, which is the case that costs
 * money:
 *
 *   createdAt    WHEN WE LEARNED IT.   Bookkeeping. Always the write instant.
 *   effectiveAt  WHEN IT BECAME TRUE.  A business fact, which a source may
 *                                      state EARLIER or LATER than the moment
 *                                      we were told.
 *
 * A supplier retracting their July list "effective 1 August", processed on
 * 5 August, stayed on offer for four days it should not have. A retraction
 * announced today and effective next Monday was removed today. Both wrong, in
 * opposite directions, and both invisible because the two instants usually
 * coincide.
 *
 * SIMPROK still does not INVENT an effective date: when no explicit one is
 * supplied the writer records the governed decision instant, and says so. What
 * changed is that the fact now has its own column instead of being inferred
 * from a bookkeeping timestamp, so a source that states one is believed.
 */
const withdrawnAudit = (
  asOf: Date,
): Prisma.BasicPricePublicationAuditWhereInput => ({
  action: WITHDRAWN_PUBLICATION_AUDIT_ACTION,
  // `lte`, so the effective instant itself is already in force (T-02).
  effectiveAt: { lte: asOf },
});

export interface BasicPriceCurrentnessOptions {
  /**
   * The instant this decision is being made FOR — required, never optional.
   *
   * It was optional once, and the absent form degraded to "a WITHDRAWN row
   * exists, therefore this price is not current". That reads a future-dated
   * withdrawal as though it were already in force, so a price vanished before
   * its own effective date. Requiring it means every caller must state which
   * clock it is on:
   *
   *   a caller with a BUSINESS date (the AHSP candidate offer) passes that
   *   date, so a historical decision is answered as of when it happened;
   *
   *   a caller that projects the PRESENT (the Explorer) resolves the instant
   *   once at its own request boundary and passes it.
   *
   * A business `asOf` must never be replaced by wall-clock "today", and a
   * present-tense read must never be answered with "at some point".
   */
  asOf: Date;
}

export const basicPriceCurrentnessWhere = (
  options: BasicPriceCurrentnessOptions,
): Prisma.BasicPriceWhereInput => {
  const { asOf } = options;
  return {
    // 1. REPLACED. The successor's own publication is proved by the database
    // rather than re-checked here: the supersession CHECK refuses this pointer
    // on any row that is not PUBLISHED on both axes, so the pointer's mere
    // existence means a lawfully published correction replaced this row. A
    // proposed-but-unpublished correction cannot exist as a pointer at all,
    // which is why a predecessor stays current until the ladder finishes.
    supersededBy: { is: null },

    // 2. WITHDRAWN — this exact row, by an explicit governed decision.
    publicationAudits: { none: withdrawnAudit(asOf) },

    // 3. RESTATES SOMETHING THAT IS NO LONGER CURRENT.
    //
    // `isNot` rather than a top-level OR, and that is load-bearing twice over:
    // it keeps this fragment to three non-colliding keys, and on an OPTIONAL
    // to-one relation it is true for a row that HAS no origin — which is almost
    // every row in the table. An ordinary workspace price is not a restatement
    // of anything and this clause must never touch it.
    promotedFrom: {
      isNot: {
        OR: [
          { supersededBy: { isNot: null } },
          { publicationAudits: { some: withdrawnAudit(asOf) } },
        ],
      },
    },
  };
};
