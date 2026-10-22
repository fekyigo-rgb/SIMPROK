-- BP-ROW11-GRADEA: immutable clarification tied to original row mapping.
CREATE TABLE "basic_price_import_row_mapping_reason_clarifications" (
  "id" UUID NOT NULL,
  "mappingId" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "originalReason" TEXT,
  "clarifiedReason" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "basic_price_import_row_mapping_reason_clarifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "basic_price_import_row_mapping_reason_clarifications_mappingId_key"
  ON "basic_price_import_row_mapping_reason_clarifications"("mappingId");
CREATE INDEX "basic_price_import_row_mapping_reason_clarifications_workspaceId_idx"
  ON "basic_price_import_row_mapping_reason_clarifications"("workspaceId");
ALTER TABLE "basic_price_import_row_mapping_reason_clarifications"
  ADD CONSTRAINT "bp_mapping_reason_clarification_mapping_fk" FOREIGN KEY ("mappingId")
  REFERENCES "basic_price_import_row_resource_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_mapping_reason_clarifications"
  ADD CONSTRAINT "bp_mapping_reason_clarification_actor_fk" FOREIGN KEY ("actorAccountId")
  REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
