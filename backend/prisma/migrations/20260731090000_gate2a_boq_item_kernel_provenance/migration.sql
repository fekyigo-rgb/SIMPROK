-- GATE-2A: truthful provenance for a server-computed RAB line (BoqItem),
-- and nullable RabDocument totals so "not authoritative yet" is a real
-- database state, never a fabricated zero or a stale leftover number.
--
-- BoqItem.priceOrigin has NO default and is nullable: a fresh row is
-- unpriced (priceOrigin IS NULL), never silently MANUAL_CLIENT. Exactly
-- three shapes are legal and are enforced by boq_items_price_origin_truth_check
-- below — no service, script, fixture, or direct Prisma writer can persist
-- a fourth shape:
--   A. UNPRICED           priceOrigin IS NULL, unitPrice/lineTotal IS NULL,
--                          all kernel provenance IS NULL
--   B. MANUAL_CLIENT       unitPrice/lineTotal IS NOT NULL,
--                          all kernel provenance IS NULL
--   C. SERVER_COST_KERNEL  unitPrice/lineTotal IS NOT NULL,
--                          all kernel provenance IS NOT NULL
--
-- Existing rows: unitPrice IS NOT NULL becomes MANUAL_CLIENT (a human price
-- that already existed before Gate-2A). unitPrice IS NULL stays
-- priceOrigin=NULL. SERVER_COST_KERNEL is never backfilled — no pre-Gate-2A
-- row was ever kernel-computed.

-- CreateEnum
CREATE TYPE "BoqItemPriceOrigin" AS ENUM ('MANUAL_CLIENT', 'SERVER_COST_KERNEL');

-- AlterTable
ALTER TABLE "boq_items"
  ADD COLUMN "priceOrigin" "BoqItemPriceOrigin",
  ADD COLUMN "calculationOccurrenceId" UUID,
  ADD COLUMN "calculationAsOfDate" DATE,
  ADD COLUMN "calculatedAt" TIMESTAMP(3),
  ADD COLUMN "calculationPolicyVersion" TEXT;

-- Backfill: truthful classification of pre-Gate-2A rows only.
UPDATE "boq_items" SET "priceOrigin" = 'MANUAL_CLIENT' WHERE "unitPrice" IS NOT NULL;

-- CreateIndex
CREATE INDEX "boq_items_calculationOccurrenceId_idx" ON "boq_items"("calculationOccurrenceId");

-- AddForeignKey
-- Restrict: a BoqItem may not outlive the ProjectAhspOccurrence it cites as
-- its calculation provenance (same convention as other provenance FKs, e.g.
-- ProjectAhspResourceResolution.selectedBasicPriceId).
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_calculationOccurrenceId_fkey" FOREIGN KEY ("calculationOccurrenceId") REFERENCES "project_ahsp_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: money is always a pair. Never one of unitPrice/lineTotal
-- set while the other is null.
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_money_pair_check" CHECK (
  ("unitPrice" IS NULL AND "lineTotal" IS NULL)
  OR
  ("unitPrice" IS NOT NULL AND "lineTotal" IS NOT NULL)
);

-- CheckConstraint: exactly the three truthful shapes A/B/C above — no
-- MANUAL_CLIENT with null money or with kernel provenance attached, no
-- SERVER_COST_KERNEL missing any provenance field, no money with a null
-- origin, no provenance attached to an unpriced row.
--
-- IS NOT DISTINCT FROM, never plain `=`, against "priceOrigin": SQL's
-- three-valued logic makes `"priceOrigin" = 'MANUAL_CLIENT'` evaluate to
-- NULL (neither TRUE nor FALSE) whenever priceOrigin IS NULL — and a CHECK
-- constraint ALLOWS a row whenever its expression evaluates to NULL, not
-- only TRUE. With plain `=` a row shaped {unitPrice: 1, priceOrigin: NULL}
-- would make branch A false (unitPrice not null), and branches B/C each
-- collapse to NULL instead of FALSE, so `FALSE OR NULL OR NULL` = NULL and
-- the constraint would wrongly ALLOW the invalid row. IS NOT DISTINCT FROM
-- is NULL-safe equality — it returns FALSE (never NULL) when priceOrigin
-- IS NULL, so an all-NULL-provenance branch never becomes a NULL escape
-- hatch for a priced-but-origin-less row.
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_price_origin_truth_check" CHECK (
  (
    "priceOrigin" IS NULL
    AND "unitPrice" IS NULL AND "lineTotal" IS NULL
    AND "calculationOccurrenceId" IS NULL AND "calculationAsOfDate" IS NULL
    AND "calculatedAt" IS NULL AND "calculationPolicyVersion" IS NULL
  )
  OR
  (
    "priceOrigin" IS NOT DISTINCT FROM 'MANUAL_CLIENT'::"BoqItemPriceOrigin"
    AND "unitPrice" IS NOT NULL AND "lineTotal" IS NOT NULL
    AND "calculationOccurrenceId" IS NULL AND "calculationAsOfDate" IS NULL
    AND "calculatedAt" IS NULL AND "calculationPolicyVersion" IS NULL
  )
  OR
  (
    "priceOrigin" IS NOT DISTINCT FROM 'SERVER_COST_KERNEL'::"BoqItemPriceOrigin"
    AND "unitPrice" IS NOT NULL AND "lineTotal" IS NOT NULL
    AND "calculationOccurrenceId" IS NOT NULL AND "calculationAsOfDate" IS NOT NULL
    AND "calculatedAt" IS NOT NULL AND "calculationPolicyVersion" IS NOT NULL
  )
);

-- AlterTable: RabDocument totals must be able to represent "not
-- authoritative yet" — never a fabricated zero, never a stale leftover
-- number while the draft is incomplete. Existing non-null totals are
-- unaffected by dropping NOT NULL.
ALTER TABLE "rab_documents" ALTER COLUMN "totalBaseCost" DROP NOT NULL;
ALTER TABLE "rab_documents" ALTER COLUMN "totalFinalCost" DROP NOT NULL;

-- PR57 Gap B: BasicPricePublicationAudit.actorAccountId gets real Account
-- referential integrity. RESTRICT on delete — an Account that has ever
-- published a price may never be deleted out from under its historical
-- audit trail (and the audit row is never silently cascaded away either).
-- This is schema-level proof of existence only; it makes no claim about
-- whether that Account is still ACTIVE today, and does not change
-- BasicPricePublicationService's publish-time authorization rules, which
-- are unmodified by this migration.

-- CreateIndex
CREATE INDEX "basic_price_publication_audits_actorAccountId_idx" ON "basic_price_publication_audits"("actorAccountId");

-- AddForeignKey
ALTER TABLE "basic_price_publication_audits" ADD CONSTRAINT "fk_basic_price_publication_audit_actor" FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
