-- CreateEnum
CREATE TYPE "BasicPriceImportRowMappingSuggestionSource" AS ENUM ('MANUAL_SEARCH', 'NORMALIZED_NAME_SINGLE_CANDIDATE', 'NORMALIZED_NAME_MULTIPLE_CANDIDATES');

-- CreateTable
CREATE TABLE "basic_price_import_row_resource_mappings" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "rowId" UUID NOT NULL,
    "resourceCatalogId" UUID NOT NULL,
    "unitDefinitionId" UUID NOT NULL,
    "reviewerAccountId" UUID NOT NULL,
    "reason" TEXT,
    "suggestionSource" "BasicPriceImportRowMappingSuggestionSource" NOT NULL,
    "candidateCountAtDecision" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "basic_price_import_row_resource_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "basic_price_import_row_resource_mappings_rowId_idx" ON "basic_price_import_row_resource_mappings"("rowId");

-- CreateIndex
CREATE INDEX "basic_price_import_row_resource_mappings_resourceCatalogId_idx" ON "basic_price_import_row_resource_mappings"("resourceCatalogId");

-- CreateIndex
CREATE INDEX "basic_price_import_row_resource_mappings_workspaceId_idx" ON "basic_price_import_row_resource_mappings"("workspaceId");

-- AddForeignKey
ALTER TABLE "basic_price_import_row_resource_mappings" ADD CONSTRAINT "basic_price_import_row_resource_mappings_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "basic_price_import_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_row_resource_mappings" ADD CONSTRAINT "basic_price_import_row_resource_mappings_resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_import_row_resource_mappings" ADD CONSTRAINT "basic_price_import_row_resource_mappings_unitDefinitionId_fkey" FOREIGN KEY ("unitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
