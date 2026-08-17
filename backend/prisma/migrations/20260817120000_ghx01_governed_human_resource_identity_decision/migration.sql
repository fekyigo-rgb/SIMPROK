-- GHX-01 — GOVERNED HUMAN RESOURCE IDENTITY DECISION MEMORY.
--
-- ADDITIVE ONLY. One new table, its indexes and its foreign keys. No existing
-- table, column, constraint or index is altered or dropped, so this migration
-- cannot change the meaning of any fact SIMPROK already holds.
--
-- WHY A DEDICATED TABLE EXISTS AT ALL
--
-- Every existing decision/review model was inspected and none can hold this fact
-- truthfully. `basic_price_import_row_resource_mappings` is bound to ONE Basic
-- Price import row — the human was never asked what an AHSP line means, so
-- reusing it would silently widen a row-scoped decision into AHSP assertion
-- authority. `review_tasks`/`review_decisions` are bound to knowledge_candidates
-- and have no consumer at all. `formal_decisions` stores free-text project
-- decisions with no catalog reference. Storing an identity selection in any of
-- them would be semantic lying.
--
-- SUBJECT = (workspaceId, ahspResourceId). Anchored to the immutable AHSP source
-- fact rather than to its spelling, so a different AHSP line sharing the same
-- name/type/unit inherits nothing. `workspaceId` is mandatory because AHSP and
-- AHSPVersion may be global ("NULL for Official Repository") and are reachable by
-- every workspace, while candidate catalog rows are workspace-scoped.
--
-- DELETION LAW, stated deliberately:
--   workspace                -> CASCADE  (a deleted tenant keeps no memory)
--   ahsp_resources           -> RESTRICT (the source fact this decision is ABOUT)
--   resource_catalogs        -> RESTRICT (the identity this decision ASSERTS)
--   accounts                 -> RESTRICT (the actor who is accountable)
--   previousDecisionId       -> RESTRICT (history is never orphaned)
--   origin* columns          -> NO FOREIGN KEY AT ALL. They are frozen historical
--     scalars. An FK would either erase the audit answer when a project is deleted
--     or let decision memory block ordinary project deletion. Integrity is proven
--     at write time instead.

CREATE TABLE "ahsp_resource_identity_decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "ahspResourceId" UUID NOT NULL,
    "selectedResourceCatalogId" UUID NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "previousDecisionId" UUID,
    "candidateContextDigest" TEXT NOT NULL,
    "candidateCountAtDecision" INTEGER NOT NULL,
    "resolutionPolicyVersion" TEXT NOT NULL,
    "decidedByAccountId" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "originProjectId" UUID NOT NULL,
    "originProjectName" TEXT NOT NULL,
    "originOccurrenceId" UUID NOT NULL,
    "originResolutionId" UUID NOT NULL,
    "originAhspVersionId" UUID NOT NULL,

    CONSTRAINT "ahsp_resource_identity_decisions_pkey" PRIMARY KEY ("id")
);

-- THE concurrency invariant. Two writers racing for the same next generation
-- cannot both win: the loser takes a unique violation, re-reads in a new
-- transaction, and either succeeds idempotently or conflicts. Two simultaneously
-- authoritative decisions for one subject are unrepresentable.
CREATE UNIQUE INDEX "ahsp_resource_identity_decisions_subject_generation_key"
    ON "ahsp_resource_identity_decisions" ("workspaceId", "ahspResourceId", "generation");

-- The only read shape the consumption seam uses: newest decision for one exact
-- subject. Bounded and indexed — never a scan, never "load all history".
CREATE INDEX "ahsp_resource_identity_decisions_subject_latest_idx"
    ON "ahsp_resource_identity_decisions" ("workspaceId", "ahspResourceId", "generation" DESC);

CREATE INDEX "ahsp_resource_identity_decisions_selectedResourceCatalogId_idx"
    ON "ahsp_resource_identity_decisions" ("selectedResourceCatalogId");

ALTER TABLE "ahsp_resource_identity_decisions"
    ADD CONSTRAINT "ahsp_resource_identity_decisions_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ahsp_resource_identity_decisions"
    ADD CONSTRAINT "ahsp_resource_identity_decisions_ahspResourceId_fkey"
    FOREIGN KEY ("ahspResourceId") REFERENCES "ahsp_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ahsp_resource_identity_decisions"
    ADD CONSTRAINT "ahsp_resource_identity_decisions_selectedResourceCatalogId_fkey"
    FOREIGN KEY ("selectedResourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ahsp_resource_identity_decisions"
    ADD CONSTRAINT "ahsp_resource_identity_decisions_decidedByAccountId_fkey"
    FOREIGN KEY ("decidedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ahsp_resource_identity_decisions"
    ADD CONSTRAINT "ahsp_resource_identity_decisions_previousDecisionId_fkey"
    FOREIGN KEY ("previousDecisionId") REFERENCES "ahsp_resource_identity_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
