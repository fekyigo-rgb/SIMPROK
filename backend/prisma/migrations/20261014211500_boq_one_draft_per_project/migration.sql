-- BOQ one-truth gate: each project may have at most one mutable BOQ draft
-- across every legacy/canonical name. Historical non-DRAFT structures remain
-- untouched; PostgreSQL enforces this under concurrent transactions as well.
CREATE UNIQUE INDEX "boq_single_draft_per_project"
ON "boq_structures" ("projectId")
WHERE "projectId" IS NOT NULL AND "status" = 'DRAFT';
