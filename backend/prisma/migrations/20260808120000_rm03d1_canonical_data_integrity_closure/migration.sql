-- RM-03D1 — CANONICAL DATA INTEGRITY CLOSURE
--
-- ONE proven reason for this migration: SIMPROK currently cannot represent an
-- already-existing business fact without false precision.
--
-- The Ambon Basic Price evidence states a PERIOD ("TA 2024") and never a day,
-- but BasicPrice.effectiveDate is NOT NULL, so an exact operational date must
-- be derived. Before this migration there was nowhere to record that the date
-- was derived, from what period, or by which rule — so a derived 2024-01-01 was
-- indistinguishable from a date the source printed. That is the false precision
-- this removes.
--
-- Nothing here changes publication law, eligibility law, unit law, or the Cost
-- Kernel. Every column is additive and nullable, so existing rows keep their
-- exact current meaning: NULL provenance reads as "unknown", never as
-- "the source stated this".

-- ── how an exact effectiveDate came to exist ─────────────────────────────────
CREATE TYPE "PriceEffectiveDateProvenance" AS ENUM ('SOURCE_STATED', 'DERIVED_FROM_SOURCE_PERIOD');

-- How coarse the source's period is, machine-readable. The label is verbatim
-- source text and no code can reason over it; this is what makes a derived date
-- checkable rather than merely described. Only YEAR exists because YEAR is the
-- only granularity the evidence in hand demonstrates.
CREATE TYPE "PriceSourcePeriodGranularity" AS ENUM ('YEAR');

-- ── the import batch records what the source said about its period ───────────
ALTER TABLE "basic_price_import_batches"
  ADD COLUMN "sourcePeriodLabel"           TEXT,
  ADD COLUMN "sourcePeriodGranularity"     "PriceSourcePeriodGranularity",
  ADD COLUMN "effectiveDateProvenance"     "PriceEffectiveDateProvenance",
  ADD COLUMN "effectiveDateDerivationRule" TEXT;

-- ── every price the batch materializes carries the same facts ────────────────
ALTER TABLE "basic_prices"
  ADD COLUMN "sourcePeriodLabel"           TEXT,
  ADD COLUMN "sourcePeriodGranularity"     "PriceSourcePeriodGranularity",
  ADD COLUMN "effectiveDateProvenance"     "PriceEffectiveDateProvenance",
  ADD COLUMN "effectiveDateDerivationRule" TEXT;

-- COHERENT PROVENANCE, OR NONE.
--
-- A DERIVED date is only honest if it can be re-derived, which needs all three:
-- the period the source stated, how coarse that period is, and the named rule
-- that turned it into a day. A blank string satisfies NOT NULL and proves
-- nothing, so the constraint tests for non-blank rather than merely present.
--
-- A SOURCE_STATED date carries no derivation rule — there was no derivation. It
-- MAY still carry a period label: a document can truthfully print both
-- "TA 2024" and an exact date, and forbidding that would force a different lie.
--
-- NULL provenance stays legal and means UNKNOWN. Every row that predates this
-- distinction keeps its exact current meaning, and unknown is never upgraded to
-- "the source stated this".
ALTER TABLE "basic_prices"
  ADD CONSTRAINT "basic_prices_effective_date_provenance_coherence_check"
  CHECK (
    (
      "effectiveDateProvenance" IS NULL
      AND "effectiveDateDerivationRule" IS NULL
    )
    OR (
      "effectiveDateProvenance" = 'SOURCE_STATED'
      AND "effectiveDateDerivationRule" IS NULL
    )
    OR (
      "effectiveDateProvenance" = 'DERIVED_FROM_SOURCE_PERIOD'
      AND "sourcePeriodLabel" IS NOT NULL
      AND btrim("sourcePeriodLabel") <> ''
      AND "sourcePeriodGranularity" IS NOT NULL
      AND "effectiveDateDerivationRule" IS NOT NULL
      AND btrim("effectiveDateDerivationRule") <> ''
    )
  );

ALTER TABLE "basic_price_import_batches"
  ADD CONSTRAINT "basic_price_batches_effective_date_provenance_coherence_check"
  CHECK (
    (
      "effectiveDateProvenance" IS NULL
      AND "effectiveDateDerivationRule" IS NULL
    )
    OR (
      "effectiveDateProvenance" = 'SOURCE_STATED'
      AND "effectiveDateDerivationRule" IS NULL
    )
    OR (
      "effectiveDateProvenance" = 'DERIVED_FROM_SOURCE_PERIOD'
      AND "sourcePeriodLabel" IS NOT NULL
      AND btrim("sourcePeriodLabel") <> ''
      AND "sourcePeriodGranularity" IS NOT NULL
      AND "effectiveDateDerivationRule" IS NOT NULL
      AND btrim("effectiveDateDerivationRule") <> ''
    )
  );

-- ── append-only history for an in-place provenance correction ────────────────
-- Overwriting a persisted provenance fact would erase the claim SIMPROK made
-- yesterday. A newer value alone is not "history preserved".
CREATE TABLE "basic_price_provenance_corrections" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "basicPriceId"   UUID NOT NULL,
  "workspaceId"    UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "reason"         TEXT NOT NULL,
  "before"         JSONB NOT NULL,
  "after"          JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "basic_price_provenance_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "basic_price_provenance_corrections_basicPriceId_idx"   ON "basic_price_provenance_corrections"("basicPriceId");
CREATE INDEX "basic_price_provenance_corrections_workspaceId_idx"    ON "basic_price_provenance_corrections"("workspaceId");
CREATE INDEX "basic_price_provenance_corrections_actorAccountId_idx" ON "basic_price_provenance_corrections"("actorAccountId");

ALTER TABLE "basic_price_provenance_corrections"
  ADD CONSTRAINT "basic_price_provenance_corrections_basicPriceId_fkey"
  FOREIGN KEY ("basicPriceId") REFERENCES "basic_prices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "basic_price_provenance_corrections"
  ADD CONSTRAINT "basic_price_provenance_corrections_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not cascade: deleting an account must never silently erase who
-- corrected a money-adjacent provenance fact.
ALTER TABLE "basic_price_provenance_corrections"
  ADD CONSTRAINT "fk_basic_price_provenance_correction_actor"
  FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
