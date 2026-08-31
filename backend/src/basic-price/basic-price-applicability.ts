import { Prisma } from '@prisma/client';

export const BASIC_PRICE_APPLICABILITY_VERSION =
  'BPUXFINAL01C_BASIC_PRICE_TEMPORAL_APPLICABILITY_V1';

/**
 * BP-UX-FINAL-01C — IS THIS PRICE APPLICABLE AT THIS INSTANT?
 *
 * SIMPROK KEEPS FOUR QUESTIONS APART, AND THIS FILE OWNS EXACTLY THE FOURTH:
 *
 *   ELIGIBILITY   (buildUsableBasicPriceWhere)      MAY this workspace lawfully
 *                                                   use this row. A permission
 *                                                   question.
 *   PRECEDENCE    (promotionLineagePrecedenceWhere) among lawful rows, is this
 *                                                   one merely a copy of another
 *                                                   the caller can already see.
 *                                                   A redundancy question.
 *   CURRENTNESS   (basicPriceCurrentnessWhere)      among lawful rows, has a
 *                                                   human REPLACED or WITHDRAWN
 *                                                   this one. A lifecycle
 *                                                   question.
 *   APPLICABILITY (here)                            among lawful rows, is this
 *                                                   one in force at the instant
 *                                                   being asked about. A
 *                                                   TEMPORAL question, stated by
 *                                                   the SOURCE, not by SIMPROK.
 *
 * NOT ONE WORD OF THIS IS NEW LAW. It is the predicate SIMPROK's two spending
 * engines have enforced all along, moved to where the OFFER is made:
 *
 *   project-ahsp/ahsp-resource-resolution.orchestrator.ts:107-108
 *       effectiveDate: { lte: asOf },
 *       AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: asOf } }] }],
 *
 *   project/rab-kernel-persistence.service.ts:293-302
 *       effectiveDate > asOf                      -> BASIC_PRICE_NOT_YET_EFFECTIVE
 *       validUntil !== null && validUntil < asOf   -> BASIC_PRICE_EXPIRED
 *
 * WHY THE EXPLORER NEEDED IT, AND WHY ITS ABSENCE WAS A DEFECT RATHER THAN A
 * DESIGN CHOICE. `basic-price-eligibility.policy.ts` states the security
 * property in as many words: "if the list could offer a price the resolver
 * would not accept (or worse, vice versa), the gap between them would be the
 * privilege escalation." The Explorer is that list. It composed eligibility,
 * precedence and currentness and then stopped — so a price whose own source
 * said it stopped being valid last year, or one that does not begin until next
 * year, was offered as CURRENTLY USABLE by the very room whose whole claim is
 * that presence means availability. The engines would then refuse it, and the
 * person would be left holding a number the product had shown them.
 *
 * WHY IT RETURNS AN ARRAY OF FRAGMENTS FOR `AND`, NOT AN OBJECT TO SPREAD.
 * This is load-bearing and is the reason it cannot break anything:
 *
 *   - `buildUsableBasicPriceWhere` owns the top-level `OR` key. A fragment that
 *     spread its own `OR` (which the validUntil clause needs) would CLOBBER
 *     eligibility outright — deleting tenant isolation rather than narrowing
 *     it. That is the single most dangerous edit possible in this file's
 *     neighbourhood, and returning `AND` fragments makes it unrepresentable.
 *   - The Explorer already assigns `where.effectiveDate` for its own
 *     year/dateFrom/dateTo range filters. A spread `effectiveDate` key would
 *     silently overwrite one with the other depending on statement order. As an
 *     `AND` member it composes with the range filter instead of racing it.
 *
 * It can therefore only ever REMOVE rows, never add one, so it can never become
 * a second route to a price eligibility refused.
 *
 * THE BOUNDARY IS INCLUSIVE (`gte`), AND THAT IS COPIED, NOT CHOSEN. A source
 * that says "valid until 30 June" means the price is still good ON 30 June.
 * Both engines above already read it that way; a different boundary here would
 * make the Explorer and the Cost Kernel disagree about the last day of every
 * price in the catalog.
 *
 * WHAT THIS IS NOT. It is NOT `reviewDate`, and it must never be confused with
 * it. `reviewDate` is SOFT advice — "look at this again" — carrying no
 * eligibility meaning whatsoever, and a price past it stays fully usable and
 * stays in every candidate set. Only `validUntil` is a hard boundary, because
 * only `validUntil` is a claim the SOURCE made about its own price.
 */
export interface BasicPriceApplicabilityOptions {
  /**
   * The instant this decision is being made FOR — required, never optional,
   * for the same reason `basicPriceCurrentnessWhere` requires it: a caller with
   * a BUSINESS date must be answered as of that date, and a caller projecting
   * the PRESENT must resolve the instant once at its own request boundary
   * rather than letting a helper reach for a clock mid-query.
   */
  asOf: Date;
}

/**
 * The applicability fragments, ready to be placed in a `AND: [...]` array.
 *
 * Two members rather than one object, so each reads as the single fact it is:
 * "it has started" and "it has not ended".
 */
export const basicPriceApplicabilityAnd = (
  options: BasicPriceApplicabilityOptions,
): Prisma.BasicPriceWhereInput[] => {
  const { asOf } = options;
  return [
    // 1. IT HAS STARTED. A future-dated price is a real, lawful, stored fact —
    // it is simply not the answer to "what does this cost now".
    { effectiveDate: { lte: asOf } },
    // 2. IT HAS NOT ENDED. `validUntil: null` is the ordinary case — most
    // sources state no end at all — and null must never read as "expired".
    { OR: [{ validUntil: null }, { validUntil: { gte: asOf } }] },
  ];
};
