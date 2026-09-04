-- BP-REGION-HIERARCHY-01 (additive only)
--
-- WHY_CURRENT_SCHEMA_IS_INSUFFICIENT:
-- `regions` stores a flat code/name. Basic Price product law names Kemendagri
-- administrative identity (Indonesia → Provinsi → Kabupaten/Kota → Kecamatan →
-- Kelurahan/Desa). A second Region table would duplicate authority. Inferring
-- parent from a name would fabricate geography. The missing facts are therefore
-- optional columns ON the existing Region row:
--
--   * administrativeLevel — the Kemendagri depth, or NULL when unknown
--   * parentId            — the canonical parent Region, or NULL when unknown
--
-- NOTHING IS INFERRED FOR EXISTING ROWS. The two live Permanent Regions
-- (`3171` Jakarta Selatan, `8171030` Kecamatan Teluk Ambon Baguala, Kota Ambon)
-- keep their ids, codes, names, and references. Both columns stay NULL on every
-- row written before this migration. NULL means UNKNOWN — not "country" and not
-- "no parent".
--
-- No column is dropped, renamed, retyped or backfilled. No existing Region is
-- rewritten. National coverage is NOT seeded here: fabricating villages would
-- be a second source of truth. Hierarchy is representable; filling it remains
-- a governed applyRegionPlan pass from an authoritative Kemendagri designation.

CREATE TYPE "RegionAdministrativeLevel" AS ENUM (
  'COUNTRY',
  'PROVINCE',
  'REGENCY_CITY',
  'DISTRICT',
  'VILLAGE'
);

ALTER TABLE "regions"
  ADD COLUMN "administrativeLevel" "RegionAdministrativeLevel",
  ADD COLUMN "parentId" UUID;

ALTER TABLE "regions"
  ADD CONSTRAINT "regions_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "regions"
  ADD CONSTRAINT "regions_parent_not_self_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

CREATE INDEX "regions_parentId_idx" ON "regions"("parentId");
