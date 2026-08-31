import { Prisma } from '@prisma/client';

export const BASIC_PRICE_CURRENTNESS_VERSION =
  'BPUXFINAL01D_BASIC_PRICE_CURRENTNESS_V3';

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
 * THE THREE REASONS A LAWFUL ROW IS NOT CURRENT — EACH ANSWERED AT `asOf`:
 *
 *   1. IT WAS REPLACED — a human published a correction naming it, and that
 *      correction had already been recorded by `asOf` (BP-UX-FINAL-01D).
 *   2. IT WAS WITHDRAWN — a human recorded that it should no longer be offered,
 *      with no replacement, effective by `asOf` (BP-CORR-01B GAP B).
 *   3. IT RESTATES SOMETHING THAT IS NO LONGER CURRENT — it is a promoted
 *      shared copy, and the origin it copied had itself been replaced or
 *      withdrawn by `asOf` (BP-CORR-01B GAP A).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BP-UX-FINAL-01D — REASON 1 BECAME TEMPORAL, AND WHY IT HAD TO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. Reason 1 used to be `supersededBy: { is: null }` — absolute, with
 * no date beside it. Reasons 2 and 3 already took an `asOf`. So a correction
 * published TODAY silently rewrote what SIMPROK would have answered LAST YEAR:
 * ask for the catalog as of March and a June correction had already deleted the
 * March truth from the answer. A historical lens that borrows tomorrow's
 * knowledge is not a historical lens; it is today wearing a costume.
 *
 * That is the exact failure the withdrawal clause was repaired for one gate
 * earlier, left standing in the clause beside it.
 *
 * THE LAW, AND WHERE IT IS WRITTEN DOWN. A correction becomes a
 * GOVERNANCE fact at the instant its transition is RECORDED — not before, and
 * not retroactively:
 *
 *   basic-price-publication.service.ts
 *       "PUBLICATION IS ALSO THE MOMENT A CORRECTION BECOMES CURRENT, which is
 *        why the supersession pointer is written here and by nothing else."
 *       ...and the atomic write makes "this row is published" and "this row
 *        replaced that one" true IN THE SAME INSTANT.
 *
 *   schema.prisma, BasicPricePublicationAudit.effectiveAt
 *       "a PUBLISH and a SUPERSEDED are INSTANTANEOUS GOVERNANCE TRANSITIONS
 *        that become true exactly when they are recorded"
 *       — which is precisely why that column is NULL for them, and why the
 *       CHECK mandates it for WITHDRAWN alone.
 *
 *   migration 20260826120000, constraint S2
 *       "a proposed correction is invisible to selection until the same
 *        two-human ladder ... has finished with it" — the predecessor stays
 *        current until the ladder finishes, so there IS a moment before which
 *        it was current and after which it is not.
 *
 * THE CANONICAL TEMPORAL ANCHOR IS THEREFORE:
 *
 *     BasicPricePublicationAudit
 *       basicPriceId = THE PREDECESSOR       (the row whose currency changed)
 *       action       = 'SUPERSEDED'
 *       createdAt    = the governance transition instant
 *
 * ONE anchor, used by reason 1 and reason 3 alike. `createdAt` and not
 * `effectiveAt` here — and that is not a relapse into the bookkeeping-timestamp
 * defect BP-CORR-01B fixed for withdrawal. The two verbs are genuinely
 * different kinds of fact:
 *
 *   WITHDRAWN   a claim the SOURCE makes about the world, which it may date
 *               earlier or later than the day SIMPROK was told. It therefore
 *               HAS an `effectiveAt`, and the CHECK refuses the row without one.
 *   SUPERSEDED  a claim SIMPROK's own governance makes about its own catalog.
 *               It becomes true when it is recorded, has no separate business
 *               instant, and its `effectiveAt` is NULL BY DESIGN — the migration
 *               refuses to back-fill one because that "would manufacture a claim
 *               nobody made".
 *
 * Reading `createdAt` for SUPERSEDED is reading the only instant that exists.
 * Reading it for WITHDRAWN would be ignoring one that does.
 *
 * IT IS NOT RETROACTIVE, AND IT IS NOT A NEW OBSERVATION EITHER. A correction
 * still means "that published fact was wrong". What changed is only WHEN
 * SIMPROK is entitled to know that: from the moment a human recorded it. Before
 * that instant SIMPROK genuinely did offer the predecessor, and a historical
 * reconstruction that pretends otherwise is rewriting its own past. Meanwhile a
 * genuinely later OBSERVATION still carries no pointer at all and still
 * replaces nothing — `PublishBasicPriceDto` keeps that distinction, and this
 * file never infers a correction from a later date, a moved value or a shared
 * resource.
 *
 * FAIL CLOSED ON A MALFORMED PAIR. A successor pointer with no SUPERSEDED audit
 * to time it cannot be answered, and an unanswerable correction must never
 * resolve to "still current" — that would fail OPEN, spending corrected-away
 * money. Such a predecessor is suppressed at every `asOf` instead.
 *
 * THE MIRROR CASE IS ALSO SAFER NOW, AND DELIBERATELY SO. The audit lives on
 * the PREDECESSOR; the pointer lives on the SUCCESSOR. They are two rows, so
 * deleting a successor leaves the predecessor's SUPERSEDED record standing —
 * and this predicate keeps honouring it. That is the right direction: the audit
 * table is APPEND-ONLY governance, and a governed decision is not un-made by a
 * row disappearing. The previous rule read `supersededBy IS NULL`, so deleting
 * a successor silently RESURRECTED the corrected-away price. Nothing in
 * production deletes a published BasicPrice (the FK is RESTRICT in the other
 * direction, and no route offers it), but if anything ever does, the answer is
 * now "still corrected" rather than "corrected money is back on offer".
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
 * IT CAN ONLY EVER REMOVE. It still must not take the top-level `OR` (eligibility)
 * or `NOT` (promotion precedence). `AND` is now the fourth key: a private
 * successor is hidden until its own `createdAt`. Callers that also need `AND`
 * (applicability / validUntil) must merge via `mergeCurrentnessAnd` rather than
 * assigning `AND` after a spread — that would silently drop this clause.
 * It never widens a result set, so it can never become a second route to a
 * price eligibility refused.
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
 * BP-UX-FINAL-01D — THE ACTION THAT TIMES A CORRECTION.
 *
 * Written by `BasicPricePublicationService.publish` on the PREDECESSOR, inside
 * the same transaction that sets the successor's pointer and publishes it. The
 * action is deliberately SUPERSEDED and never PUBLISH — the Cost Kernel proves
 * a publisher by looking for PUBLISH on that exact price, so a correction
 * wearing that action would answer the two-human ladder on the predecessor's
 * behalf.
 */
export const SUPERSEDED_PUBLICATION_AUDIT_ACTION = 'SUPERSEDED';

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

/**
 * BP-UX-FINAL-01D — A CORRECTION THAT HAD ALREADY BEEN RECORDED BY `asOf`.
 *
 * `createdAt`, because for this action there is no other instant: schema law
 * states a SUPERSEDED transition "becomes true exactly when it is recorded",
 * and its `effectiveAt` is NULL by design. `lte`, so the transition instant
 * itself is already in force — the same boundary the withdrawal clause uses.
 */
const supersededAudit = (
  asOf: Date,
): Prisma.BasicPricePublicationAuditWhereInput => ({
  action: SUPERSEDED_PUBLICATION_AUDIT_ACTION,
  createdAt: { lte: asOf },
});

/** Any supersession record at all, at any instant. Used only to detect absence. */
const anySupersededAudit: Prisma.BasicPricePublicationAuditWhereInput = {
  action: SUPERSEDED_PUBLICATION_AUDIT_ACTION,
};

/**
 * A SUCCESSOR THAT NAMES THIS ROW BUT WHOSE TRANSITION WAS NEVER RECORDED.
 *
 * `supersedes` on the successor points straight back at the row being judged,
 * so this whole expression reads: "a correction OF ME, for which MY governance
 * record is missing".
 *
 * Catalog successors are PUBLISHED+PUBLISHED (CHECK S2) and therefore not
 * UNVERIFIED. A malformed catalog pair — pointer present, SUPERSEDED audit
 * absent — must suppress the predecessor at every `asOf`, because reason 2
 * would otherwise answer "not yet corrected" forever.
 *
 * The discriminator is `verificationStatus`, not assetScope and not the
 * substring PUBLISHED: those belong to eligibility and publication. CHECK S2
 * already says a pointed-to successor is either published catalog truth or a
 * private UNVERIFIED row. This fragment reuses that same axis.
 */
const catalogSuccessorWithNoGovernanceRecord: Prisma.BasicPriceWhereInput = {
  AND: [
    { verificationStatus: { not: 'UNVERIFIED' } },
    { supersedes: { is: { publicationAudits: { none: anySupersededAudit } } } },
  ],
};

/**
 * BP-DETAIL-MAINT-02 — a private successor becomes current at its own
 * `createdAt`. Private pointed successors are UNVERIFIED by CHECK S2.
 * Historical `asOf` before that instant keeps the predecessor current.
 * Same `asOf` parameter as catalog; no second time engine.
 */
const privateSuccessorAlreadyInForce = (
  asOf: Date,
): Prisma.BasicPriceWhereInput => ({
  AND: [{ verificationStatus: 'UNVERIFIED' }, { createdAt: { lte: asOf } }],
});

/**
 * BP-DETAIL-MAINT-02R — THE SUCCESSOR HALF OF THE SAME CREATEDAT CLOCK.
 *
 * `privateSuccessorAlreadyInForce` stops the PREDECESSOR being current after T.
 * It does not hide the successor itself. Applicability reads `effectiveDate`,
 * and a private correction copies that date, so an August successor of a March
 * observation would otherwise appear in a March historical answer.
 *
 * Nested `OR`, never a top-level one: origins (`supersedesBasicPriceId` null)
 * and catalog successors (`verificationStatus` not UNVERIFIED) stay on the
 * source `effectiveDate` clock. Only an UNVERIFIED pointed successor is timed
 * by when SIMPROK recorded it. Same `asOf`. No second engine.
 */
const privateSuccessorRecordedByAsOf = (
  asOf: Date,
): Prisma.BasicPriceWhereInput => ({
  OR: [
    { supersedesBasicPriceId: null },
    { verificationStatus: { not: 'UNVERIFIED' } },
    { createdAt: { lte: asOf } },
  ],
});

const asAndArray = (
  andInput: Prisma.BasicPriceWhereInput['AND'],
): Prisma.BasicPriceWhereInput[] => {
  if (!andInput) return [];
  return Array.isArray(andInput) ? [...andInput] : [andInput];
};

/**
 * Compose currentness with another `AND` fragment without overwriting the
 * private-successor recorded-by-asOf clause.
 */
export const mergeCurrentnessAnd = (
  currentness: Prisma.BasicPriceWhereInput,
  extraAnd: Prisma.BasicPriceWhereInput[],
): Prisma.BasicPriceWhereInput => {
  const { AND, ...rest } = currentness;
  return {
    ...rest,
    AND: [...asAndArray(AND), ...extraAnd],
  };
};

/**
 * A ROW WHOSE OWN CORRECTION HAD TAKEN GOVERNANCE EFFECT BY `asOf` — or whose
 * correction cannot be timed at all.
 *
 * Stated as a standalone predicate because reason 3 asks it about a DIFFERENT
 * row (the promotion origin), where it can be asked directly rather than
 * through the round trip above.
 */
const supersededAsOf = (asOf: Date): Prisma.BasicPriceWhereInput => ({
  OR: [
    { publicationAudits: { some: supersededAudit(asOf) } },
    {
      AND: [
        { supersededBy: { isNot: null } },
        { publicationAudits: { none: anySupersededAudit } },
      ],
    },
  ],
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
    // Catalog successors with a SUPERSEDED audit are timed by reason 2.
    // A catalog successor whose predecessor has no such audit fails closed
    // at every `asOf`. A private UNVERIFIED successor is timed by createdAt.
    supersededBy: {
      isNot: {
        OR: [
          catalogSuccessorWithNoGovernanceRecord,
          privateSuccessorAlreadyInForce(asOf),
        ],
      },
    },

    // BP-DETAIL-MAINT-02R — hide the private successor itself until T.
    AND: [privateSuccessorRecordedByAsOf(asOf)],

    // 2. NO GOVERNED EVENT HAD TAKEN THIS ROW OUT OF CURRENCY BY `asOf`.
    //
    // Both verbs, one key, one `asOf` — and each compared against the instant
    // that verb actually owns:
    //
    //   WITHDRAWN   `effectiveAt` — the SOURCE's claim about the world, which
    //               it may date earlier or later than the day we were told.
    //   SUPERSEDED  `createdAt`   — SIMPROK's own governance transition, which
    //               becomes true exactly when recorded and has no other
    //               instant (its `effectiveAt` is NULL by design).
    //
    // Merged into one `none` rather than split across two keys because they ask
    // the same question — "has anything governed already ended this row's
    // currency by D" — and because the top-level `OR` and `NOT` keys belong to
    // eligibility and precedence. This fragment's own `AND` is merged at
    // callers that also need applicability, never overwritten.
    publicationAudits: {
      none: { OR: [withdrawnAudit(asOf), supersededAudit(asOf)] },
    },

    // 3. RESTATES SOMETHING THAT IS NO LONGER CURRENT.
    //
    // `isNot` rather than a top-level OR, and that is load-bearing twice over:
    // it keeps this fragment to three non-colliding keys, and on an OPTIONAL
    // to-one relation it is true for a row that HAS no origin — which is almost
    // every row in the table. An ordinary workspace price is not a restatement
    // of anything and this clause must never touch it.
    // BP-UX-FINAL-01D — and it inherits reason 1's clock exactly. This used to
    // read `supersededBy: { isNot: null }`, so a shared restatement vanished
    // from every historical answer the moment its origin was corrected TODAY.
    // The descendant now follows the origin on the origin's own governance
    // instant, which is the same rule reason 1 applies to the origin itself —
    // one law, asked about two rows, never two shadow engines.
    promotedFrom: {
      isNot: {
        OR: [
          supersededAsOf(asOf),
          { publicationAudits: { some: withdrawnAudit(asOf) } },
        ],
      },
    },
  };
};
