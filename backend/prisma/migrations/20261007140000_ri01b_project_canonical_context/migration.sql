-- RI-01B — Project canonical context foundation. Additive only.
--
-- WHY:
-- A Project had no durable binding to ConstructionClassificationNode or Region.
-- Project.location and Project.address are not that binding and are left untouched.
--
-- THIS MIGRATION:
--   * creates project_classification_selections (Project → ConstructionClassificationNode)
--   * creates project_region_selections (Project → Region)
--   * stores ids only; names, codes, levels, and parents stay on the canonical rows
--
-- DOES NOT:
--   * drop, rename, retype, or rewrite any existing table or column
--   * backfill selections
--   * change Project, AHSP, Region, or classification node rows

CREATE TABLE "project_classification_selections" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "classificationNodeId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_classification_selections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_classification_selections_projectId_classificationNodeId_key"
  ON "project_classification_selections"("projectId", "classificationNodeId");

CREATE INDEX "project_classification_selections_projectId_idx"
  ON "project_classification_selections"("projectId");

CREATE INDEX "project_classification_selections_classificationNodeId_idx"
  ON "project_classification_selections"("classificationNodeId");

ALTER TABLE "project_classification_selections"
  ADD CONSTRAINT "project_classification_selections_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_classification_selections"
  ADD CONSTRAINT "project_classification_selections_classificationNodeId_fkey"
  FOREIGN KEY ("classificationNodeId") REFERENCES "construction_classification_nodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_region_selections" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "regionId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_region_selections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_region_selections_projectId_regionId_key"
  ON "project_region_selections"("projectId", "regionId");

CREATE INDEX "project_region_selections_projectId_idx"
  ON "project_region_selections"("projectId");

CREATE INDEX "project_region_selections_regionId_idx"
  ON "project_region_selections"("regionId");

ALTER TABLE "project_region_selections"
  ADD CONSTRAINT "project_region_selections_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_region_selections"
  ADD CONSTRAINT "project_region_selections_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
