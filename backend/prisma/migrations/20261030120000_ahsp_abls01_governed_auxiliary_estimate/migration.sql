CREATE TYPE "ProjectAhspPriceMode" AS ENUM ('BASIC_PRICE', 'TEMPORARY_ESTIMATE');
CREATE TYPE "AuxiliaryEquipmentEstimatePolicyDecision" AS ENUM ('APPROVED', 'HOLD', 'REVOKED');

CREATE TABLE "auxiliary_equipment_estimate_policies" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "ahspVersionId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "decision" "AuxiliaryEquipmentEstimatePolicyDecision" NOT NULL,
  "percent" DECIMAL(9,6),
  "evidenceReference" TEXT NOT NULL,
  "approvalReference" TEXT,
  "approvedByAccountId" UUID,
  "approvedByPositionId" UUID,
  "approvedByPositionAssignmentId" UUID,
  "approvedByPositionAuthorityId" UUID,
  "approvalAuthorityCode" TEXT,
  "approvedAt" TIMESTAMP(3),
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auxiliary_equipment_estimate_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aeep_positive_version_check" CHECK ("version" > 0),
  CONSTRAINT "aeep_effective_window_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" >= "effectiveFrom"),
  CONSTRAINT "aeep_approval_shape_check" CHECK (
    ("decision" = 'APPROVED' AND "percent" > 0 AND "percent" <= 100
      AND "approvalReference" IS NOT NULL AND "approvedByAccountId" IS NOT NULL
      AND "approvedByPositionId" IS NOT NULL AND "approvedByPositionAssignmentId" IS NOT NULL
      AND "approvedByPositionAuthorityId" IS NOT NULL AND "approvalAuthorityCode" IS NOT NULL
      AND "approvedAt" IS NOT NULL)
    OR
    ("decision" <> 'APPROVED' AND "percent" IS NULL)
  )
);

CREATE UNIQUE INDEX "aeep_scope_version_key" ON "auxiliary_equipment_estimate_policies"("workspaceId", "ahspVersionId", "version");
CREATE INDEX "auxiliary_equipment_estimate_policies_workspaceId_ahspVersionId_effectiveFrom_idx"
  ON "auxiliary_equipment_estimate_policies"("workspaceId", "ahspVersionId", "effectiveFrom");

ALTER TABLE "auxiliary_equipment_estimate_policies"
  ADD CONSTRAINT "aeep_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "aeep_ahsp_version_fkey" FOREIGN KEY ("ahspVersionId") REFERENCES "ahsp_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "aeep_account_fkey" FOREIGN KEY ("approvedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "aeep_position_fkey" FOREIGN KEY ("approvedByPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "aeep_assignment_fkey" FOREIGN KEY ("approvedByPositionAssignmentId") REFERENCES "position_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "aeep_authority_fkey" FOREIGN KEY ("approvedByPositionAuthorityId") REFERENCES "position_authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_auxiliary_estimate_policy_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'auxiliary equipment estimate policies are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "aeep_append_only_update" BEFORE UPDATE ON "auxiliary_equipment_estimate_policies"
  FOR EACH ROW EXECUTE FUNCTION reject_auxiliary_estimate_policy_mutation();
CREATE TRIGGER "aeep_append_only_delete" BEFORE DELETE ON "auxiliary_equipment_estimate_policies"
  FOR EACH ROW EXECUTE FUNCTION reject_auxiliary_estimate_policy_mutation();

ALTER TABLE "project_ahsp_resource_resolutions"
  ADD COLUMN "priceMode" "ProjectAhspPriceMode",
  ADD COLUMN "estimatePolicyId" UUID,
  ADD COLUMN "estimatePolicyVersion" INTEGER,
  ADD COLUMN "estimatePercent" DECIMAL(9,6),
  ADD COLUMN "estimateBasisAmount" DECIMAL(38,8),
  ADD COLUMN "estimateDerivedAmount" DECIMAL(48,18),
  ADD COLUMN "estimateApprovalReference" TEXT,
  ADD COLUMN "estimateApprovedByAccountId" UUID,
  ADD COLUMN "estimateApprovedByPositionId" UUID,
  ADD COLUMN "estimateAuthorityCode" TEXT,
  ADD COLUMN "estimateApprovedAt" TIMESTAMP(3),
  ADD CONSTRAINT "pahr_estimate_policy_fkey" FOREIGN KEY ("estimatePolicyId") REFERENCES "auxiliary_equipment_estimate_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pahr_price_mode_shape_check" CHECK (
    "priceMode" IS NULL
    OR ("priceMode" = 'BASIC_PRICE' AND "selectedBasicPriceId" IS NOT NULL
      AND "sourcePriceValue" IS NOT NULL AND "adaptedPriceValue" IS NOT NULL
      AND "estimatePolicyId" IS NULL)
    OR ("priceMode" = 'TEMPORARY_ESTIMATE' AND "selectedBasicPriceId" IS NULL
      AND "sourcePriceValue" IS NULL AND "adaptedPriceValue" IS NOT NULL
      AND "resourceCatalogId" IS NOT NULL AND "estimatePolicyId" IS NOT NULL
      AND "estimatePolicyVersion" IS NOT NULL AND "estimatePercent" IS NOT NULL
      AND "estimateBasisAmount" > 0 AND "estimateDerivedAmount" > 0
      AND "estimateApprovalReference" IS NOT NULL AND "estimateApprovedByAccountId" IS NOT NULL
      AND "estimateApprovedByPositionId" IS NOT NULL AND "estimateAuthorityCode" IS NOT NULL
      AND "estimateApprovedAt" IS NOT NULL)
  );

CREATE INDEX "project_ahsp_resource_resolutions_estimatePolicyId_idx"
  ON "project_ahsp_resource_resolutions"("estimatePolicyId");
