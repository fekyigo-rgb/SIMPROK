-- RM-03C: USER_PRIVATE_BASIC_PRICE — ownership/asset scope for BasicPrice.
--
-- Owner law (ONE SIMPROK BASIC PRICE PRODUCT MODEL, RM-03C):
-- a workspace may own a Basic Price that is usable by that workspace
-- immediately, needs no verifier, no publisher and no second human, is never
-- called PUBLISHED, and never enters the national catalog by itself.
--
-- Before this migration the table could express only three of the four
-- meanings the law needs: CATALOG_IN_REVIEW_PIPELINE, PUBLIC_PUBLISHED and
-- REJECTED/EXPIRED. There was no column whose meaning was "this row is a
-- workspace-private asset, usable by its owner, and was never intended for the
-- national catalog" — see
-- docs/implementation-gates/rm03b-private-assets/03-SCHEMA-DECISION-PACKET.md.
--
-- assetScope is an OWNERSHIP axis. It is NOT publication status, NOT
-- verification status, NOT source family / sourceOrigin, NOT freshness, and
-- NOT proposal status. Those axes keep their own columns and their own
-- meanings, unchanged by this migration.
--
-- This migration is purely ADDITIVE: two new nullable-then-defaulted columns,
-- one FK, TWO new indexes (one unique provenance index on sourceImportRowId
-- and one workspaceId+assetScope composite index), and five CHECK constraints.
-- No existing column is dropped, retyped, renamed or rewritten; no existing
-- constraint is altered; no existing migration is edited. Reversing it
-- (dropping the two columns and the enum) restores exactly today's behaviour.

-- CreateEnum
CREATE TYPE "BasicPriceAssetScope" AS ENUM ('WORKSPACE_PRIVATE', 'SIMPROK_CATALOG');

-- AlterTable: added NULLABLE first, on purpose. A column added with a default
-- would silently classify every historical row as a side effect of DDL; the
-- classification below is written as an explicit, inspectable statement
-- instead, so the backfill decision is reviewable in the diff rather than
-- hidden in a column default.
ALTER TABLE "basic_prices"
  ADD COLUMN "assetScope" "BasicPriceAssetScope",
  ADD COLUMN "sourceImportRowId" UUID;

-- Backfill: classify every pre-RM-03C row as SIMPROK_CATALOG.
--
-- REPOSITORY LINEAGE (supporting argument, not proof of canonical data):
--   1. The only production creator of a BasicPrice row is
--      reality-intake/price-submission-review.service.ts (the ACCEPT branch of
--      the curation review), which always sets sourceSubmissionId. The only
--      other production writer, basic-price/basic-price-publication.service.ts,
--      is an UPDATE of status/verificationStatus on a row that writer created.
--      Both are catalog-curation code paths. This exact two-writer inventory is
--      pinned byte-for-byte by basic-price-writer-inventory.spec.ts.
--   2. Before this migration there was no representation of privateness at
--      all — no column, no constraint, no writer. A row that no code could
--      mark private cannot retroactively have been private.
--
--   Repository writer lineage alone cannot prove what is actually IN canonical
--   data: it says nothing about an old script, an earlier runtime, a manual
--   SQL operation, or an untracked procedure.
--
-- CANONICAL EVIDENCE (read-only pre-merge preflight, 2026-08-07, simprok_db):
--   public.basic_prices contained ZERO rows, and pg_stat_user_tables reported
--   n_tup_ins = 0 — no row has ever been inserted into this table on the
--   canonical cluster. Every related table (price_submissions, reviews,
--   decisions, submission audits, publication audits, import batches/rows) was
--   likewise empty. LEGACY_ROW_COUNT = 0, AMBIGUOUS_COUNT = 0.
--
--   So on current canonical data this UPDATE is operationally VACUOUS: it will
--   affect 0 rows. It is retained because it must stay correct for any
--   environment that does hold pre-RM-03C rows, and because the classification
--   belongs in the diff rather than hidden in a column default.
--
-- WORKSPACE_PRIVATE is never backfilled onto any historical row.
UPDATE "basic_prices" SET "assetScope" = 'SIMPROK_CATALOG' WHERE "assetScope" IS NULL;

-- Now enforce the column. The default is SIMPROK_CATALOG so that any writer
-- which has not been taught about private assets fails closed into the curated
-- catalog world — it can never accidentally mint a privately-usable price.
ALTER TABLE "basic_prices"
  ALTER COLUMN "assetScope" SET NOT NULL,
  ALTER COLUMN "assetScope" SET DEFAULT 'SIMPROK_CATALOG';

-- CreateIndex: the private eligibility branch always filters on BOTH columns
-- together (strict workspace equality AND assetScope), never either alone.
CREATE UNIQUE INDEX "basic_prices_sourceImportRowId_key" ON "basic_prices"("sourceImportRowId");
CREATE INDEX "basic_prices_workspaceId_assetScope_idx" ON "basic_prices"("workspaceId", "assetScope");

-- AddForeignKey: RESTRICT, matching every other provenance FK in this schema
-- (BasicPriceImportRow.priceSubmissionId, BoqItem.calculationOccurrenceId).
-- A private price may not outlive the import row that is its only evidence,
-- and that evidence may never be silently cascaded away either.
ALTER TABLE "basic_prices"
  ADD CONSTRAINT "basic_prices_sourceImportRowId_fkey"
  FOREIGN KEY ("sourceImportRowId") REFERENCES "basic_price_import_rows"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The four private-asset invariants, enforced by the database ─────────────
--
-- Each is written as "NOT private OR <requirement>" so that SIMPROK_CATALOG
-- rows are entirely unaffected, and each is validated by Postgres against
-- every existing row at ADD CONSTRAINT time. If any historical row could not
-- be classified truthfully, one of these would fail here and the migration
-- would stop — fail-closed, never a silent partial classification.

-- I1. A private asset belongs to exactly ONE workspace. A null-workspace
-- "private" row is the shape that would leak to every tenant at once if the
-- eligibility predicate were ever written loosely, so it is made
-- unrepresentable rather than merely unwritten.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_private_requires_workspace_check" CHECK (
  "assetScope" <> 'WORKSPACE_PRIVATE' OR "workspaceId" IS NOT NULL
);

-- I2. A private asset is never submission-born. PriceSubmission is the
-- catalog curation entity; a private price that carried one would be sitting
-- in the national queue waiting for a publisher who should never have been
-- asked.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_private_not_submission_born_check" CHECK (
  "assetScope" <> 'WORKSPACE_PRIVATE' OR "sourceSubmissionId" IS NULL
);

-- I3. PRIVATE_USABLE != PUBLISHED. A private price is usable by its owner
-- WITHOUT publication, and must therefore never wear publication's clothes on
-- either axis. This is what makes "no fake publication" a database fact rather
-- than a code convention: even BasicPricePublicationService's UPDATE — the one
-- writer permitted to set these values — cannot land them on a private row.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_private_never_published_check" CHECK (
  "assetScope" <> 'WORKSPACE_PRIVATE'
  OR ("status" <> 'PUBLISHED' AND "verificationStatus" <> 'PUBLISHED')
);

-- I4a. A private asset always carries traceable evidence. SIMPROK never
-- invents a price, a source, a resource, a unit, a region or an effective
-- date; a private price with no import-row provenance would be exactly such an
-- unattributable fact.
--
-- NOTE for a future authorized gate: if manual private entry is ever added, it
-- must bring its own honest evidence record and this constraint must be
-- WIDENED to accept it — never dropped to allow evidence-free rows.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_private_requires_import_row_provenance_check" CHECK (
  "assetScope" <> 'WORKSPACE_PRIVATE' OR "sourceImportRowId" IS NOT NULL
);

-- I4b. ...and the direct import-row link is the PRIVATE channel only. A
-- catalog row reaches its import row through
-- sourceSubmission -> PriceSubmission.importRow; letting it also carry the
-- direct link would create two provenance paths for one row, which is one
-- source of truth too many.
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_import_row_link_private_only_check" CHECK (
  "sourceImportRowId" IS NULL OR "assetScope" = 'WORKSPACE_PRIVATE'
);
