-- RM-03D1 — RAB LOCK / FREEZE v1
--
-- ONE RAB, ONE HOUSE, THREE STATES: DRAFT -> LOCKED -> APPROVED.
--
-- `rab_documents.status` is already TEXT DEFAULT 'DRAFT' and can hold 'LOCKED'
-- today, so nothing here creates a status column, an enum, a second RAB
-- entity, or a baseline. This migration adds ONLY the traceability a Grade-A
-- freeze has to be able to answer: who locked it, when, and from what state.
--
-- Why on the row instead of an audit table: every existing durable audit
-- mechanism is bound by a NOT NULL foreign key into its own domain
-- (ahsp_audit_logs -> ahsps, basic_price_publication_audits -> basic_prices,
-- basic_price_provenance_corrections -> basic_prices), and knowledge_events is
-- the immutable reality-intake ledger. None can carry "this RAB was frozen".
-- Three nullable columns on the row being frozen is the smallest honest answer
-- that does not invent a governance table.

ALTER TABLE "rab_documents"
  ADD COLUMN "lockedAt"          TIMESTAMP(3),
  ADD COLUMN "lockedByAccountId" UUID,
  ADD COLUMN "lockedFromStatus"  TEXT;

-- Restrict, not cascade: deleting an account must never silently erase who
-- froze a RAB. Same rule the price-correction actor already follows.
ALTER TABLE "rab_documents"
  ADD CONSTRAINT "fk_rab_document_locked_by"
  FOREIGN KEY ("lockedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "rab_documents_lockedByAccountId_idx" ON "rab_documents"("lockedByAccountId");

-- A LOCK FACT IS WHOLE, OR IT IS ABSENT.
--
-- A half-written lock — a timestamp with no actor, an actor with no prior
-- state — would be a freeze nobody can be held to. Either all three columns
-- are present or all three are NULL; there is no partially-recorded lock.
-- NULL stays legal and means "never locked", so every existing DRAFT row keeps
-- its exact current meaning.
ALTER TABLE "rab_documents"
  ADD CONSTRAINT "rab_documents_lock_provenance_coherence_check"
  CHECK (
    (
      "lockedAt" IS NULL
      AND "lockedByAccountId" IS NULL
      AND "lockedFromStatus" IS NULL
    )
    OR (
      "lockedAt" IS NOT NULL
      AND "lockedByAccountId" IS NOT NULL
      AND "lockedFromStatus" IS NOT NULL
      AND btrim("lockedFromStatus") <> ''
    )
  );

-- A frozen RAB must carry its lock provenance.
--
-- Deliberately one-directional: LOCKED requires the lock fact, but the lock
-- fact is NOT erased when a RAB later becomes APPROVED — who froze it stays
-- true after approval. DRAFT rows are untouched by this rule.
ALTER TABLE "rab_documents"
  ADD CONSTRAINT "rab_documents_locked_requires_lock_provenance_check"
  CHECK (
    "status" <> 'LOCKED'
    OR (
      "lockedAt" IS NOT NULL
      AND "lockedByAccountId" IS NOT NULL
      AND "lockedFromStatus" IS NOT NULL
    )
  );
