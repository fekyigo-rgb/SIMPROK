-- BP-KDN-01 — ITEM / RESOURCE %KDN OBSERVATION FACT + IMPORT PROVENANCE.
--
-- ADDITIVE ONLY. No backfill, no rewrite of ResourceCatalog.tkdnValue, no
-- Project/RAB TKDN fields, no destructive DDL. Every existing BasicPrice and
-- import row keeps NULL, which is the honest answer: none of them carried a
-- governed %KDN observation, and this migration does not invent one.
--
-- WHY EXISTING ARCHITECTURE WAS INSUFFICIENT.
-- ResourceCatalog.tkdnValue is one nullable Decimal(5,2) per canonical
-- resource identity. One ResourceCatalog already admits many source sightings
-- (ResourceSourceIdentity) and many BasicPrice observations (region / date /
-- vendor / import row). Collapsing every %KDN into that one slot would
-- silently overwrite one lawful source/spec fact with another. rawSourceContext
-- on the import row is evidence that no calculation may read. BasicPrice had
-- no accompanying %KDN column. Therefore a minimum additive observation fact
-- (BasicPrice.kdnPercent) plus dedicated import-row provenance is required.

CREATE TYPE "BasicPriceKdnEstablishment" AS ENUM (
  'SOURCE_IMPORT_ROW',
  'MANUAL_ENRICHMENT'
);

CREATE TYPE "BasicPriceKdnMappingStatus" AS ENUM (
  'ABSENT',
  'ESTABLISHED',
  'NEEDS_REVIEW'
);

ALTER TABLE "basic_prices" ADD COLUMN "kdnPercent" DECIMAL(5, 2);
ALTER TABLE "basic_prices" ADD COLUMN "kdnEstablishment" "BasicPriceKdnEstablishment";

ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_kdn_pair_check" CHECK (
  ("kdnPercent" IS NULL AND "kdnEstablishment" IS NULL)
  OR ("kdnPercent" IS NOT NULL AND "kdnEstablishment" IS NOT NULL)
);

ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_kdn_range_check" CHECK (
  "kdnPercent" IS NULL
  OR ("kdnPercent" >= 0 AND "kdnPercent" <= 100)
);

ALTER TABLE "basic_price_import_batches" ADD COLUMN "interpretationKdnColumn" INTEGER;
ALTER TABLE "basic_price_import_batches"
  ADD COLUMN "kdnMappingStatus" "BasicPriceKdnMappingStatus" NOT NULL DEFAULT 'ABSENT';
ALTER TABLE "basic_price_import_batches" ADD COLUMN "kdnMappingCandidates" JSONB;

ALTER TABLE "basic_price_import_rows" ADD COLUMN "sourceKdnCellAddress" TEXT;
ALTER TABLE "basic_price_import_rows" ADD COLUMN "sourceKdnHeaderText" TEXT;
ALTER TABLE "basic_price_import_rows" ADD COLUMN "proposedCanonicalKdn" DECIMAL(5, 2);
ALTER TABLE "basic_price_import_rows" ADD COLUMN "rawKdnTextValue" TEXT;
ALTER TABLE "basic_price_import_rows" ADD COLUMN "rawKdnNumericRoundTripString" TEXT;
ALTER TABLE "basic_price_import_rows" ADD COLUMN "rawKdnDisplayText" TEXT;
ALTER TABLE "basic_price_import_rows" ADD COLUMN "kdnReasonCode" TEXT;

ALTER TABLE "basic_price_import_rows" ADD CONSTRAINT "basic_price_import_rows_kdn_range_check" CHECK (
  "proposedCanonicalKdn" IS NULL
  OR ("proposedCanonicalKdn" >= 0 AND "proposedCanonicalKdn" <= 100)
);
