ALTER TABLE "project_ahsp_occurrences"
  ADD COLUMN "businessPricingAsOfDate" DATE,
  ADD COLUMN "referenceRegionId" UUID,
  ADD COLUMN "resolutionPolicyVersion" TEXT,
  ADD COLUMN "requestPayloadHash" TEXT,
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "previousOccurrenceId" UUID,
  ADD COLUMN "resolutionContentFingerprint" TEXT,
  ADD COLUMN "resolutionEvaluatedAt" TIMESTAMP(3),
  ADD COLUMN "contextCapturedByAccountId" UUID;

ALTER TABLE "boq_items" ADD COLUMN "workingOccurrenceId" UUID;

ALTER TABLE "project_ahsp_occurrences"
  ADD CONSTRAINT "project_ahsp_occurrences_referenceRegionId_fkey" FOREIGN KEY ("referenceRegionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_ahsp_occurrences_previousOccurrenceId_fkey" FOREIGN KEY ("previousOccurrenceId") REFERENCES "project_ahsp_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_ahsp_occurrences_contextCapturedByAccountId_fkey" FOREIGN KEY ("contextCapturedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "boq_items"
  ADD CONSTRAINT "boq_items_workingOccurrenceId_fkey" FOREIGN KEY ("workingOccurrenceId") REFERENCES "project_ahsp_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "project_ahsp_occurrences_referenceRegionId_idx" ON "project_ahsp_occurrences"("referenceRegionId");
CREATE INDEX "project_ahsp_occurrences_previousOccurrenceId_idx" ON "project_ahsp_occurrences"("previousOccurrenceId");
CREATE INDEX "project_ahsp_occurrences_context_generation_idx" ON "project_ahsp_occurrences"("workspaceId", "projectId", "ahspVersionId", "businessPricingAsOfDate", "referenceRegionId", "resolutionPolicyVersion", "generation");
CREATE INDEX "boq_items_workingOccurrenceId_idx" ON "boq_items"("workingOccurrenceId");

-- No unique constraint is created in E1A. The proposed invariant "at most
-- one non-superseded generation per business-context key" is withheld for
-- Architect review because PostgreSQL NULL handling requires an explicit
-- NULLS NOT DISTINCT decision.
