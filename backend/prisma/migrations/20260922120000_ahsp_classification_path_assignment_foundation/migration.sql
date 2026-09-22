-- AHSP Classification Path Assignment Foundation — additive only
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- AHSP.fieldCategory / subCategory / classification are free-text scalars.
-- They cannot represent one AHSP → many lawful classification paths, cannot
-- FK to construction_classification_nodes, and cannot distinguish
-- SOURCE_DERIVED vs HUMAN_ADDED provenance.
--
-- THIS MIGRATION:
--   * creates AhspClassificationAssignmentProvenance enum
--   * creates ahsp_classification_assignments table
--   * FKs to ahsps (Cascade) and construction_classification_nodes (Restrict)
--   * unique (ahspId, leafNodeId, provenance) so source+human same path coexist
--
-- DOES NOT:
--   * touch AHSP scalar classification fields
--   * backfill or invent assignments
--   * alter Slice-1 classification foundation
--   * mutate Resource / Unit / Import tables

CREATE TYPE "AhspClassificationAssignmentProvenance" AS ENUM (
  'SOURCE_DERIVED',
  'HUMAN_ADDED'
);

CREATE TABLE "ahsp_classification_assignments" (
  "id" UUID NOT NULL,
  "ahspId" UUID NOT NULL,
  "leafNodeId" UUID NOT NULL,
  "provenance" "AhspClassificationAssignmentProvenance" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ahsp_classification_assignments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ahsp_classification_assignments"
  ADD CONSTRAINT "ahsp_classification_assignments_ahspId_fkey"
  FOREIGN KEY ("ahspId") REFERENCES "ahsps"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ahsp_classification_assignments"
  ADD CONSTRAINT "ahsp_classification_assignments_leafNodeId_fkey"
  FOREIGN KEY ("leafNodeId") REFERENCES "construction_classification_nodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ahsp_classification_assignments_ahspId_leafNodeId_provenance_key"
  ON "ahsp_classification_assignments"("ahspId", "leafNodeId", "provenance");

CREATE INDEX "ahsp_classification_assignments_ahspId_idx"
  ON "ahsp_classification_assignments"("ahspId");

CREATE INDEX "ahsp_classification_assignments_leafNodeId_idx"
  ON "ahsp_classification_assignments"("leafNodeId");

CREATE INDEX "ahsp_classification_assignments_ahspId_isActive_idx"
  ON "ahsp_classification_assignments"("ahspId", "isActive");
