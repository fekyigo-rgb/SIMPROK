-- BP-CAT-01D §19 — PROMOTED ROWS ARE PUBLISHED TRUTH, ENFORCED BY THE DATABASE.
--
-- ADDITIVE ONLY. One CHECK constraint. No column, no backfill, no data rewrite,
-- no destructive DDL, and the previously-applied lineage migration is left
-- exactly as it was rather than rewritten -- migration history that has already
-- run in rehearsal is a record of what happened, not a draft.
--
-- WHY THIS IS LAWFUL AND NOT MERELY TIDY. The lineage migration already made a
-- promoted row prove it is SHARED (workspaceId IS NULL, organizationId IS NULL,
-- assetScope = 'SIMPROK_CATALOG'). It did NOT constrain the two publication
-- axes, which left one representable state that no writer can produce and no
-- law permits: a shared descendant that is not published.
--
-- There is no lawful counterexample today. BasicPricePromotionService is the
-- only writer that can set `promotedFromBasicPriceId`, it always writes both
-- axes as PUBLISHED, it refuses any origin that has not already completed the
-- publication ladder on BOTH axes, and no writer anywhere updates a promoted
-- row afterwards. Shared promotion is a restatement of settled published truth,
-- so an unpublished restatement is a contradiction in terms.
--
-- FOR A FUTURE AUTHORIZED GATE: published correction / supersession is
-- deliberately out of scope here. If a later slice ever needs to withdraw a
-- shared descendant, this constraint must be WIDENED to describe that withdrawal
-- honestly -- never dropped to let an unexplained state back in.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_promoted_row_is_published_check" CHECK (
  "promotedFromBasicPriceId" IS NULL
  OR ("status" = 'PUBLISHED' AND "verificationStatus" = 'PUBLISHED')
);
