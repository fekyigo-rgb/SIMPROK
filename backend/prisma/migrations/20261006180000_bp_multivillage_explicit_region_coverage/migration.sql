-- BP-MULTIVILLAGE-02 - additive explicit Region coverage only.
-- Legacy scalar regionId rows keep their exact meaning; no row is backfilled.

CREATE TABLE "basic_price_region_coverage_sets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "anchorRegionId" UUID NOT NULL,
  "deterministicDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "basic_price_region_coverage_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "basic_price_region_coverage_members" (
  "coverageSetId" UUID NOT NULL,
  "regionId" UUID NOT NULL,

  CONSTRAINT "basic_price_region_coverage_members_pkey"
    PRIMARY KEY ("coverageSetId", "regionId")
);

ALTER TABLE "basic_price_import_batches"
  ADD COLUMN "regionCoverageSetId" UUID;

ALTER TABLE "price_submissions"
  ADD COLUMN "regionCoverageSetId" UUID;

ALTER TABLE "basic_prices"
  ADD COLUMN "regionCoverageSetId" UUID;

CREATE UNIQUE INDEX "basic_price_region_coverage_sets_deterministicDigest_key"
  ON "basic_price_region_coverage_sets"("deterministicDigest");

CREATE INDEX "basic_price_region_coverage_sets_anchorRegionId_idx"
  ON "basic_price_region_coverage_sets"("anchorRegionId");

CREATE INDEX "basic_price_region_coverage_members_regionId_idx"
  ON "basic_price_region_coverage_members"("regionId");

CREATE INDEX "basic_price_import_batches_regionCoverageSetId_idx"
  ON "basic_price_import_batches"("regionCoverageSetId");

CREATE INDEX "price_submissions_regionCoverageSetId_idx"
  ON "price_submissions"("regionCoverageSetId");

CREATE INDEX "basic_prices_regionCoverageSetId_idx"
  ON "basic_prices"("regionCoverageSetId");

ALTER TABLE "basic_price_region_coverage_sets"
  ADD CONSTRAINT "basic_price_region_coverage_sets_anchorRegionId_fkey"
  FOREIGN KEY ("anchorRegionId") REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "basic_price_region_coverage_members"
  ADD CONSTRAINT "basic_price_region_coverage_members_coverageSetId_fkey"
  FOREIGN KEY ("coverageSetId")
  REFERENCES "basic_price_region_coverage_sets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "basic_price_region_coverage_members"
  ADD CONSTRAINT "basic_price_region_coverage_members_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "regions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "basic_price_import_batches"
  ADD CONSTRAINT "basic_price_import_batches_regionCoverageSetId_fkey"
  FOREIGN KEY ("regionCoverageSetId")
  REFERENCES "basic_price_region_coverage_sets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "price_submissions"
  ADD CONSTRAINT "price_submissions_regionCoverageSetId_fkey"
  FOREIGN KEY ("regionCoverageSetId")
  REFERENCES "basic_price_region_coverage_sets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "basic_prices"
  ADD CONSTRAINT "basic_prices_regionCoverageSetId_fkey"
  FOREIGN KEY ("regionCoverageSetId")
  REFERENCES "basic_price_region_coverage_sets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
