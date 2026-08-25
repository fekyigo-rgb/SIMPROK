-- BP-CAT-01B — SHARED CATALOG PROMOTION LINEAGE.
--
-- ADDITIVE ONLY. One nullable column, one unique index, one self FK, two CHECK
-- constraints. No backfill, no data rewrite, no destructive DDL. Every row that
-- exists before this migration keeps NULL, which is the honest answer: none of
-- them was produced by promotion, and this migration does not invent a history
-- for them.

ALTER TABLE "basic_prices" ADD COLUMN "promotedFromBasicPriceId" UUID;

-- IDEMPOTENCY AS A DATABASE FACT.
--
-- PostgreSQL treats NULLs as distinct in a UNIQUE index, so this permits
-- unlimited non-promoted rows while allowing at most ONE shared result per
-- originating price. A second promotion of the same origin is refused by the
-- database itself (23505 -> Prisma P2002), never only by application code that
-- a future caller might forget to route through. No partial index is needed:
-- ordinary nullable uniqueness already expresses exactly this invariant.
CREATE UNIQUE INDEX "basic_prices_promotedFromBasicPriceId_key"
  ON "basic_prices"("promotedFromBasicPriceId");

-- HISTORY CANNOT BE DELETED OUT FROM UNDER SHARED TRUTH.
--
-- RESTRICT, never CASCADE: if a shared catalog price is standing on this
-- origin, the origin may not be removed. Promotion preserves the originating
-- row; this makes that preservation enforceable rather than merely intended.
ALTER TABLE "basic_prices"
  ADD CONSTRAINT "basic_prices_promotedFromBasicPriceId_fkey"
  FOREIGN KEY ("promotedFromBasicPriceId") REFERENCES "basic_prices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- P1. A row cannot be its own origin. The alternative — a price that claims to
-- have been promoted from itself — would satisfy the FK and read as a valid
-- lineage while meaning nothing.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_promotion_not_self_check" CHECK (
  "promotedFromBasicPriceId" IS NULL OR "promotedFromBasicPriceId" <> "id"
);

-- P2. Only a SHARED catalog row may carry a promotion lineage. A workspace-owned
-- or workspace-private row wearing this column would claim to be national truth
-- while still belonging to one tenant — the exact confusion the whole feature
-- exists to avoid. Made unrepresentable rather than merely unwritten, in the
-- same spirit as the RM-03C private-asset invariants above it.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_promoted_row_is_shared_check" CHECK (
  "promotedFromBasicPriceId" IS NULL
  OR (
    "workspaceId" IS NULL
    AND "organizationId" IS NULL
    AND "assetScope" = 'SIMPROK_CATALOG'
  )
);
