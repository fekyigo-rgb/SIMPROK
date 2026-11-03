-- RAB canonical unit identity: freeze the existing Unit Kernel proof at the
-- immutable AHSP occurrence. No second alias, converter or engine.
-- Historical rows remain NULL and use the original exact-string gate.
ALTER TABLE "project_ahsp_occurrences"
  ADD COLUMN "boqUnitAtSelection" TEXT,
  ADD COLUMN "ahspOutputUnitAtSelection" TEXT,
  ADD COLUMN "canonicalOutputUnitDefinitionId" UUID;
ALTER TABLE "project_ahsp_occurrences"
  ADD CONSTRAINT "fk_project_ahsp_occurrences_canonical_output_unit"
  FOREIGN KEY ("canonicalOutputUnitDefinitionId") REFERENCES "unit_definitions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "project_ahsp_occurrences_canonical_output_unit_idx"
  ON "project_ahsp_occurrences"("canonicalOutputUnitDefinitionId");
