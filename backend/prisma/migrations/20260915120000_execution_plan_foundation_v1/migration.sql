-- MON-04 OFFICIAL EXECUTION PLAN FOUNDATION v1
-- Canonical truth is versioned plan metadata plus explicit WORK_ITEM period
-- increments. Cumulative quantity, planned progress, weight, and planned curve
-- are derived and are deliberately not stored here.

CREATE TYPE "ExecutionPlanStatus" AS ENUM ('DRAFT', 'LOCKED');

CREATE UNIQUE INDEX "project_baselines_id_projectId_key"
  ON "project_baselines"("id", "projectId");

CREATE TABLE "execution_plan_versions" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "baselineId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" "ExecutionPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "predecessorId" UUID,
  "createdByAccountId" UUID NOT NULL,
  "lastEditedByAccountId" UUID NOT NULL,
  "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedByAccountId" UUID,
  "lockedByPositionId" UUID,
  "lockedFromRevision" INTEGER,
  "lockedFromProjectStatus" "ProjectStatus",
  "lockedAuthorityCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "execution_plan_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "execution_plan_version_positive_identity_check"
    CHECK ("versionNumber" > 0 AND "revision" > 0),
  CONSTRAINT "execution_plan_version_predecessor_not_self_check"
    CHECK ("predecessorId" IS NULL OR "predecessorId" <> "id"),
  CONSTRAINT "execution_plan_version_lock_truth_check"
    CHECK (
      (
        "status" = 'DRAFT'
        AND "lockedAt" IS NULL
        AND "lockedByAccountId" IS NULL
        AND "lockedByPositionId" IS NULL
        AND "lockedFromRevision" IS NULL
        AND "lockedFromProjectStatus" IS NULL
        AND "lockedAuthorityCode" IS NULL
      )
      OR
      (
        "status" = 'LOCKED'
        AND "lockedAt" IS NOT NULL
        AND "lockedByAccountId" IS NOT NULL
        AND "lockedByPositionId" IS NOT NULL
        AND "lockedFromRevision" = "revision"
        AND "lockedFromProjectStatus" IN ('PLANNED', 'ACTIVE')
        AND "lockedAuthorityCode" = 'EXECUTION_PLAN_LOCK'
      )
    )
);

CREATE TABLE "execution_plan_distributions" (
  "id" UUID NOT NULL,
  "executionPlanVersionId" UUID NOT NULL,
  "boqItemId" UUID NOT NULL,
  "periodStartDate" DATE NOT NULL,
  "periodEndDate" DATE NOT NULL,
  "plannedIncrementalQuantity" DECIMAL(18,6) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "execution_plan_distributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "execution_plan_distribution_date_order_check"
    CHECK ("periodStartDate" <= "periodEndDate"),
  CONSTRAINT "execution_plan_distribution_positive_quantity_check"
    CHECK ("plannedIncrementalQuantity" > 0)
);

CREATE UNIQUE INDEX "execution_plan_versions_projectId_versionNumber_key"
  ON "execution_plan_versions"("projectId", "versionNumber");
CREATE UNIQUE INDEX "execution_plan_one_draft_per_context_key"
  ON "execution_plan_versions"("projectId", "baselineId")
  WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "execution_plan_one_locked_per_context_key"
  ON "execution_plan_versions"("projectId", "baselineId")
  WHERE "status" = 'LOCKED';

CREATE INDEX "execution_plan_versions_projectId_baselineId_status_idx"
  ON "execution_plan_versions"("projectId", "baselineId", "status");
CREATE INDEX "execution_plan_versions_baselineId_idx"
  ON "execution_plan_versions"("baselineId");
CREATE INDEX "execution_plan_versions_predecessorId_idx"
  ON "execution_plan_versions"("predecessorId");
CREATE INDEX "execution_plan_versions_createdByAccountId_idx"
  ON "execution_plan_versions"("createdByAccountId");
CREATE INDEX "execution_plan_versions_lastEditedByAccountId_idx"
  ON "execution_plan_versions"("lastEditedByAccountId");
CREATE INDEX "execution_plan_versions_lockedByAccountId_idx"
  ON "execution_plan_versions"("lockedByAccountId");
CREATE INDEX "execution_plan_versions_lockedByPositionId_idx"
  ON "execution_plan_versions"("lockedByPositionId");
CREATE INDEX "execution_plan_distributions_executionPlanVersionId_boqItemId_idx"
  ON "execution_plan_distributions"("executionPlanVersionId", "boqItemId");
CREATE INDEX "execution_plan_distributions_boqItemId_idx"
  ON "execution_plan_distributions"("boqItemId");
CREATE INDEX "execution_plan_distributions_executionPlanVersionId_periodEndDate_idx"
  ON "execution_plan_distributions"("executionPlanVersionId", "periodEndDate");

ALTER TABLE "execution_plan_versions"
  ADD CONSTRAINT "execution_plan_versions_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_versions_baselineId_projectId_fkey"
  FOREIGN KEY ("baselineId", "projectId") REFERENCES "project_baselines"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_versions_predecessorId_fkey"
  FOREIGN KEY ("predecessorId") REFERENCES "execution_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_versions_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_versions_lastEditedByAccountId_fkey"
  FOREIGN KEY ("lastEditedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_versions_lockedByAccountId_fkey"
  FOREIGN KEY ("lockedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_versions_lockedByPositionId_fkey"
  FOREIGN KEY ("lockedByPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "execution_plan_distributions"
  ADD CONSTRAINT "execution_plan_distributions_executionPlanVersionId_fkey"
  FOREIGN KEY ("executionPlanVersionId") REFERENCES "execution_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_plan_distributions_boqItemId_fkey"
  FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
