-- RM-02 Basic Price import foundation.
-- See docs/implementation-gates/rm02b0-design/01-RM02B0-SCHEMA-CONTRACT.md
-- and 08-RM02B0-PROVISIONAL-MIGRATION-DESIGN.md for the full design
-- contract this migration implements, and
-- docs/implementation-gates/RM02B0_PRODUCTION_FACT_RECONCILIATION.md for
-- the production facts that make steps 5/6 (Region FK) safe to add without
-- gating (existing_non_null_region_id_count=0 at preflight time).
--
-- Proven against a disposable PostgreSQL 17 instance loaded with a
-- production-shaped fixture (1 BasicPrice PUBLISHED/PUBLISHED/158333.33,
-- 143 BoqItem rows including the real -5.00 legacy negative-quantity row)
-- before being applied to simprok_test. Never applied to simprok_db by
-- this task.
--
-- Excluded from this migration, by design: three RenameForeignKey
-- statements Prisma's diff tool proposes for pre-existing
-- project_ahsp_resource_resolutions constraints. Confirmed (by diffing
-- the unmodified schema.prisma against the same migration history) to be
-- pre-existing drift between that table's original hand-shortened
-- constraint names and Prisma's current naming algorithm, unrelated to
-- this change. project_ahsp_resource_resolutions is locked BP-AHSP Phase 2
-- scope and outside this task's allowlist, so those renames are left for a
-- separately-scoped fix rather than folded in here.

-- CreateEnum
CREATE TYPE "BasicPriceImportBatchStatus" AS ENUM ('PREVIEWED', 'READY_FOR_REVIEW', 'NEEDS_REVIEW', 'APPROVED_FOR_SUBMISSION', 'PARTIALLY_SUBMITTED', 'SUBMITTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BasicPriceImportRowSection" AS ENUM ('LABOR', 'MATERIAL', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "BasicPriceImportRowCollisionType" AS ENUM ('NONE', 'EXACT_DUPLICATE', 'SAME_IDENTITY_SAME_VALUE', 'SAME_IDENTITY_DIFFERENT_VALUE', 'CODE_COLLISION', 'NAME_COLLISION', 'UNIT_COLLISION');

-- CreateEnum
CREATE TYPE "BasicPriceImportRowResolutionStatus" AS ENUM ('UNRESOLVED', 'RESOURCE_UNKNOWN', 'RESOURCE_AMBIGUOUS', 'RESOURCE_TYPE_CONFLICT', 'UNIT_UNKNOWN', 'UNIT_AMBIGUOUS', 'UNIT_CONVERSION_REQUIRED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BasicPriceImportRowStatus" AS ENUM ('PARSED', 'NEEDS_REVIEW', 'READY_FOR_SUBMISSION', 'REJECTED', 'SUBMISSION_CREATED');

-- AlterTable
ALTER TABLE "basic_prices" ALTER COLUMN "status" SET DEFAULT 'UNPUBLISHED';

-- AlterTable
ALTER TABLE "boq_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,6);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basic_price_import_batches" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "uploadedByAccountId" UUID NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourceByteLength" INTEGER NOT NULL,
    "selectedSheetName" TEXT NOT NULL,
    "parserContractVersion" TEXT NOT NULL,
    "regionId" UUID,
    "effectiveDate" TIMESTAMP(3),
    "effectiveDateSetByAccountId" UUID,
    "effectiveDateSetAt" TIMESTAMP(3),
    "sourceType" "PriceSourceType",
    "sourceOrigin" "PriceSourceOrigin",
    "sourceOrganizationName" TEXT,
    "sourceVendorName" TEXT,
    "priceCoverageDeclared" BOOLEAN NOT NULL DEFAULT false,
    "transportIncluded" BOOLEAN,
    "loadingIncluded" BOOLEAN,
    "unloadingIncluded" BOOLEAN,
    "deliveredToProject" BOOLEAN,
    "importFingerprint" TEXT NOT NULL,
    "status" "BasicPriceImportBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "reviewedByAccountId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "basic_price_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basic_price_import_rows" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sourceSection" "BasicPriceImportRowSection" NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sourceCodeCellAddress" TEXT NOT NULL,
    "sourceNameCellAddress" TEXT NOT NULL,
    "sourceUnitCellAddress" TEXT NOT NULL,
    "sourcePriceCellAddress" TEXT NOT NULL,
    "rawResourceCodeText" TEXT,
    "rawResourceNameText" TEXT NOT NULL,
    "rawUnitText" TEXT,
    "rawPriceCellType" INTEGER NOT NULL,
    "rawPriceNumericRoundTripString" TEXT,
    "rawPriceTextValue" TEXT,
    "rawPriceFormulaText" TEXT,
    "rawPriceCachedResultRoundTripString" TEXT,
    "rawPriceFormulaError" TEXT,
    "rawPriceNumberFormat" TEXT,
    "rawPriceDisplayText" TEXT,
    "proposedCanonicalPrice" DECIMAL(18,2),
    "canonicalRoundingMode" TEXT,
    "resourceCatalogId" UUID,
    "resolvedResourceType" "ResourceType",
    "unitDefinitionId" UUID,
    "collisionType" "BasicPriceImportRowCollisionType" NOT NULL DEFAULT 'NONE',
    "collisionOfRowId" UUID,
    "resolutionStatus" "BasicPriceImportRowResolutionStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "reasonCodes" TEXT[],
    "status" "BasicPriceImportRowStatus" NOT NULL DEFAULT 'PARSED',
    "resolvedByAccountId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "effectiveDateOverride" TIMESTAMP(3),
    "priceSubmissionId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "basic_price_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basic_price_publication_audits" (
    "id" UUID NOT NULL,
    "basicPriceId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "basic_price_publication_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");

-- CreateIndex
CREATE INDEX "basic_price_import_batches_workspaceId_idx" ON "basic_price_import_batches"("workspaceId");

-- CreateIndex
CREATE INDEX "basic_price_import_batches_organizationId_idx" ON "basic_price_import_batches"("organizationId");

-- CreateIndex
CREATE INDEX "basic_price_import_batches_status_idx" ON "basic_price_import_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "basic_price_import_batches_workspaceId_importFingerprint_key" ON "basic_price_import_batches"("workspaceId", "importFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "basic_price_import_rows_priceSubmissionId_key" ON "basic_price_import_rows"("priceSubmissionId");

-- CreateIndex
CREATE INDEX "basic_price_import_rows_batchId_idx" ON "basic_price_import_rows"("batchId");

-- CreateIndex
CREATE INDEX "basic_price_import_rows_status_idx" ON "basic_price_import_rows"("status");

-- CreateIndex
CREATE INDEX "basic_price_import_rows_resolutionStatus_idx" ON "basic_price_import_rows"("resolutionStatus");

-- CreateIndex
CREATE INDEX "basic_price_import_rows_resourceCatalogId_idx" ON "basic_price_import_rows"("resourceCatalogId");

-- CreateIndex
CREATE UNIQUE INDEX "basic_price_import_rows_batchId_sourceRowNumber_key" ON "basic_price_import_rows"("batchId", "sourceRowNumber");

-- CreateIndex
CREATE INDEX "basic_price_publication_audits_basicPriceId_idx" ON "basic_price_publication_audits"("basicPriceId");

-- CreateIndex
CREATE INDEX "basic_prices_regionId_idx" ON "basic_prices"("regionId");

-- CreateIndex
CREATE INDEX "price_submissions_regionId_idx" ON "price_submissions"("regionId");

-- AddForeignKey
ALTER TABLE "price_submissions" ADD CONSTRAINT "price_submissions_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_batches" ADD CONSTRAINT "basic_price_import_batches_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_rows" ADD CONSTRAINT "basic_price_import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "basic_price_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_rows" ADD CONSTRAINT "basic_price_import_rows_resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_rows" ADD CONSTRAINT "basic_price_import_rows_unitDefinitionId_fkey" FOREIGN KEY ("unitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_rows" ADD CONSTRAINT "basic_price_import_rows_priceSubmissionId_fkey" FOREIGN KEY ("priceSubmissionId") REFERENCES "price_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_rows" ADD CONSTRAINT "basic_price_import_rows_collisionOfRowId_fkey" FOREIGN KEY ("collisionOfRowId") REFERENCES "basic_price_import_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_publication_audits" ADD CONSTRAINT "basic_price_publication_audits_basicPriceId_fkey" FOREIGN KEY ("basicPriceId") REFERENCES "basic_prices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
