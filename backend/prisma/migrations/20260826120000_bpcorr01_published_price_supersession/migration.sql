-- BP-CORR-01 — PUBLISHED BASIC PRICE CORRECTION + SUPERSESSION.
--
-- ADDITIVE ONLY. One nullable column, one unique index, one self FK, three
-- CHECK constraints. No backfill, no data rewrite, no destructive DDL, and no
-- previously-applied migration is rewritten. Every row that exists before this
-- migration keeps NULL, which is the honest answer: none of them corrected
-- anything, and this migration does not invent a predecessor for them.
--
-- THE ONE FACT THAT WAS MISSING. SIMPROK could already say how a private price
-- was re-DESCRIBED (basic_price_provenance_corrections, which may never move
-- money) and which shared row RESTATES which workspace origin
-- ("promotedFromBasicPriceId"). It could not say which published price REPLACED
-- which prior published price. That sentence is what this column adds, and
-- nothing else.
--
-- HISTORY IS NOT EDITED TO MAKE TODAY LOOK CORRECT. The predecessor row is not
-- touched by this migration or by the writer that uses the column: no flag, no
-- date, no status change, no delete. The successor carries the entire
-- relationship, so "is A still current" is answered by asking whether anything
-- points AT A -- a question that cannot be answered wrongly by mutating A.

ALTER TABLE "basic_prices" ADD COLUMN "supersedesBasicPriceId" UUID;

-- ONE CURRENT TRUTH, AS A DATABASE FACT.
--
-- PostgreSQL treats NULLs as distinct in a UNIQUE index, so this permits
-- unlimited non-correcting rows while allowing at most ONE successor per
-- predecessor. A correction chain therefore cannot fork: A -> B and A -> B'
-- is refused by the database itself (23505 -> Prisma P2002), never only by
-- application code that a future caller might forget to route through. That is
-- the whole of the "no two simultaneously competing current truths" invariant,
-- expressed where it cannot be bypassed.
CREATE UNIQUE INDEX "basic_prices_supersedesBasicPriceId_key"
  ON "basic_prices"("supersedesBasicPriceId");

-- A SUPERSEDED PREDECESSOR CANNOT BE DELETED OUT FROM UNDER ITS SUCCESSOR.
--
-- RESTRICT, never CASCADE, for the same reason the promotion lineage FK above
-- it is RESTRICT: a correction that outlived the thing it corrected would be a
-- claim with no referent, and CASCADE would silently delete the correction
-- instead of refusing the deletion.
ALTER TABLE "basic_prices"
  ADD CONSTRAINT "basic_prices_supersedesBasicPriceId_fkey"
  FOREIGN KEY ("supersedesBasicPriceId") REFERENCES "basic_prices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- S1. A row cannot supersede itself. The alternative — a price that claims to
-- have replaced itself — satisfies the FK, reads as a valid correction, and
-- means nothing. It would also make the row permanently non-current by its own
-- pointer, which is a self-erasure no law asks for.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_supersession_not_self_check" CHECK (
  "supersedesBasicPriceId" IS NULL OR "supersedesBasicPriceId" <> "id"
);

-- S2. ONLY A PUBLISHED ROW MAY SUPERSEDE ANYTHING, and this is what makes
-- "correction is not automatically publication" structural rather than merely
-- intended.
--
-- The currentness read is `predecessor.supersededBy IS NULL`. If an
-- unpublished draft successor could carry this pointer, that read would drop
-- the predecessor out of candidacy the moment a correction was merely PROPOSED
-- — money would move on an unreviewed claim, and the workspace would be left
-- with no current price at all. Requiring both publication axes on the row that
-- carries the pointer means a proposed correction is invisible to selection
-- until the same two-human ladder that governs every other published price has
-- finished with it. Nothing else has to remember to check.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_supersession_successor_is_published_check" CHECK (
  "supersedesBasicPriceId" IS NULL
  OR ("status" = 'PUBLISHED' AND "verificationStatus" = 'PUBLISHED')
);

-- S3. THE TWO LINEAGES STAY DISJOINT. A shared descendant restates a settled
-- truth for other tenants; it decides nothing and may never also claim to have
-- corrected something. Letting one row carry both pointers would make a
-- promotion look like a correction of the price it copied — the precise
-- confusion that would rewrite promotion history as correction history.
--
-- It is also what keeps promotion precedence exact: a shared row can never be
-- the thing that drops a workspace origin out of candidacy.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_supersession_not_promoted_row_check" CHECK (
  "supersedesBasicPriceId" IS NULL OR "promotedFromBasicPriceId" IS NULL
);

-- NO CYCLE CONSTRAINT IS PRESENT, AND NONE IS NEEDED — cycles are unreachable
-- rather than merely unwritten, so a trigger here would be ceremony.
--
-- The pointer is written exactly once per row, inside the single publication
-- transition, and only ever at a predecessor that is ALREADY PUBLISHED. A row's
-- own publication is the last moment its pointer can be set (the transition
-- refuses any source that is not exactly UNPUBLISHED+VERIFIED, so a published
-- row can never be published again). Therefore every arrow points strictly
-- backwards in publication order, and nothing can point at a row that has not
-- been published yet. A -> A is refused by S1; A -> B -> A would require A's
-- pointer to be written after A was published, which no writer can do.
