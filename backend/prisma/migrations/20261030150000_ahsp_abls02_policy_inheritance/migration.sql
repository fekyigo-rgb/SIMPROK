-- ABLS-02: additive policy scopes. No policy or percentage is seeded.
CREATE TYPE "AuxiliaryEquipmentEstimatePolicyScopeKind" AS ENUM
  ('AHSP_VERSION', 'CLASSIFICATION_NODE', 'WORKSPACE_FALLBACK');

ALTER TABLE "auxiliary_equipment_estimate_policies"
  ADD COLUMN "scopeKind" "AuxiliaryEquipmentEstimatePolicyScopeKind" NOT NULL DEFAULT 'AHSP_VERSION',
  ADD COLUMN "classificationNodeId" UUID,
  ALTER COLUMN "ahspVersionId" DROP NOT NULL;

ALTER TABLE "auxiliary_equipment_estimate_policies"
  ADD CONSTRAINT "aeep_classification_node_fkey"
    FOREIGN KEY ("classificationNodeId") REFERENCES "construction_classification_nodes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "aeep_exactly_one_scope_target_check" CHECK (
    ("scopeKind" = 'AHSP_VERSION' AND "ahspVersionId" IS NOT NULL AND "classificationNodeId" IS NULL)
    OR ("scopeKind" = 'CLASSIFICATION_NODE' AND "ahspVersionId" IS NULL AND "classificationNodeId" IS NOT NULL)
    OR ("scopeKind" = 'WORKSPACE_FALLBACK' AND "ahspVersionId" IS NULL AND "classificationNodeId" IS NULL)
  );

DROP INDEX "aeep_scope_version_key";
CREATE UNIQUE INDEX "aeep_ahsp_version_scope_version_key"
  ON "auxiliary_equipment_estimate_policies" ("workspaceId", "ahspVersionId", "version")
  WHERE "scopeKind" = 'AHSP_VERSION';
CREATE UNIQUE INDEX "aeep_classification_scope_version_key"
  ON "auxiliary_equipment_estimate_policies" ("workspaceId", "classificationNodeId", "version")
  WHERE "scopeKind" = 'CLASSIFICATION_NODE';
CREATE UNIQUE INDEX "aeep_workspace_fallback_scope_version_key"
  ON "auxiliary_equipment_estimate_policies" ("workspaceId", "version")
  WHERE "scopeKind" = 'WORKSPACE_FALLBACK';
CREATE INDEX "aeep_workspace_classification_effective_idx"
  ON "auxiliary_equipment_estimate_policies" ("workspaceId", "classificationNodeId", "effectiveFrom");

-- Both ABLS-01 append-only triggers remain installed and unchanged.
