import { Prisma } from '@prisma/client';

export const PROMOTION_LINEAGE_PRECEDENCE_VERSION =
  'BPCAT01E_PROMOTION_LINEAGE_PRECEDENCE_V1';

/**
 * BP-CAT-01E — WHICH LAWFUL ROW SHOULD COMPETE, WHICH IS A DIFFERENT QUESTION
 * FROM WHICH ROWS ARE LAWFUL.
 *
 * Canonical eligibility (`buildUsableBasicPriceWhere`) answers exactly one
 * thing: MAY this workspace lawfully use this row. This file answers the other
 * one: among rows that are already lawful, which single row represents the one
 * logical truth in this caller's context.
 *
 * They were briefly the same function, and that was the mistake this corrects.
 * Folding precedence into eligibility made a lawful shared row read as NOT
 * LAWFUL for the workspace that produced it — which is false. That row is
 * perfectly lawful for them; it is merely redundant, because they can already
 * see the origin it was copied from. Lawfulness is a permission question and
 * belongs to the policy; redundancy is a presentation question and belongs
 * here.
 *
 * THE RULE, and only this rule: a shared descendant is shadowed for the
 * workspace that owns its ORIGIN. Never by equal value (an independent
 * observation that happens to cost the same is a different truth and must
 * survive), never by resource, date, region or source name. Exact
 * `promotedFromBasicPriceId` lineage is the only identity that qualifies.
 *
 * WHY A WHERE-FRAGMENT RATHER THAN AN IN-MEMORY FILTER: the consumers that need
 * it already query BasicPrice, and some of them paginate. A post-fetch filter
 * would drop a descendant only when its origin happened to land in the same
 * page, which is a correctness bug that would surface as an occasional
 * duplicate. Composing at the query keeps it exact and costs one NOT EXISTS
 * against a unique-indexed column.
 *
 * IT OWNS NO ELIGIBILITY LAW. It never widens a result set — it can only remove
 * a row the caller was already entitled to — so it can never become a second
 * route to a price that eligibility refused.
 */
export const promotionLineagePrecedenceWhere = (
  workspaceId: string,
): Prisma.BasicPriceWhereInput => ({
  // Keyed on the ORIGIN's workspace, never on the descendant's own (which is
  // always null), so a shared row is hidden from exactly one workspace and
  // stays reachable for every other tenant — the entire point of promoting it.
  NOT: { promotedFrom: { is: { workspaceId } } },
});
