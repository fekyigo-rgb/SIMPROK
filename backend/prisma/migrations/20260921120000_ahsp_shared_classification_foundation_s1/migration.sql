-- AHSP Shared Classification Foundation (Slice 1) — additive only
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- Jenis Pengadaan options live as a frontend constant on Buat RAB / Ruang
-- Interaksi. Bidang/Subkategori/Jenis Pekerjaan live as curated FE constants
-- and as free-text on AHSP rows. There is no durable shared classification
-- node store with lawful parent-child levels and GLOBAL/WORKSPACE scope.
--
-- THIS MIGRATION:
--   * creates ConstructionClassificationLevel enum
--   * creates construction_classification_nodes table
--   * enforces parent-not-self and root-vs-nonroot parent presence via CHECK
--   * uniqueness uses NULLS NOT DISTINCT (PG15+) so GLOBAL roots (parent NULL)
--     and WORKSPACE customs cannot silently duplicate within scope
--
-- DOES NOT:
--   * seed invented Kategori/Subkategori/Jenis Pekerjaan values
--   * touch AHSP.fieldCategory / subCategory / classification / workType
--   * create AHSP assignment relations (Slice 2)
--   * drop, rename, retype, or backfill any existing column

CREATE TYPE "ConstructionClassificationLevel" AS ENUM (
  'JENIS_PENGADAAN',
  'KATEGORI',
  'SUBKATEGORI',
  'JENIS_PEKERJAAN'
);

CREATE TABLE "construction_classification_nodes" (
  "id" UUID NOT NULL,
  "level" "ConstructionClassificationLevel" NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "code" TEXT,
  "parentId" UUID,
  "workspaceId" UUID,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "construction_classification_nodes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "construction_classification_nodes"
  ADD CONSTRAINT "construction_classification_nodes_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "construction_classification_nodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "construction_classification_nodes"
  ADD CONSTRAINT "construction_classification_nodes_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "construction_classification_nodes"
  ADD CONSTRAINT "construction_classification_nodes_parent_not_self_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Roots (JENIS_PENGADAAN) must have no parent; all other levels must have one.
ALTER TABLE "construction_classification_nodes"
  ADD CONSTRAINT "construction_classification_nodes_root_parent_check"
  CHECK (
    ("level" = 'JENIS_PENGADAAN' AND "parentId" IS NULL)
    OR
    ("level" <> 'JENIS_PENGADAAN' AND "parentId" IS NOT NULL)
  );

CREATE INDEX "construction_classification_nodes_parentId_idx"
  ON "construction_classification_nodes"("parentId");

CREATE INDEX "construction_classification_nodes_workspaceId_idx"
  ON "construction_classification_nodes"("workspaceId");

CREATE INDEX "construction_classification_nodes_level_normalizedName_idx"
  ON "construction_classification_nodes"("level", "normalizedName");

CREATE INDEX "construction_classification_nodes_workspaceId_level_normalizedName_idx"
  ON "construction_classification_nodes"("workspaceId", "level", "normalizedName");

-- GLOBAL uniqueness: same level + parent + normalized name (workspaceId IS NULL)
CREATE UNIQUE INDEX "construction_classification_nodes_global_identity_uidx"
  ON "construction_classification_nodes" ("level", "parentId", "normalizedName")
  NULLS NOT DISTINCT
  WHERE "workspaceId" IS NULL AND "isActive" = true;

-- WORKSPACE uniqueness: same workspace + level + parent + normalized name
CREATE UNIQUE INDEX "construction_classification_nodes_workspace_identity_uidx"
  ON "construction_classification_nodes" ("workspaceId", "level", "parentId", "normalizedName")
  NULLS NOT DISTINCT
  WHERE "workspaceId" IS NOT NULL AND "isActive" = true;
