-- CreateEnum
CREATE TYPE "ProjectAhspResolutionStatus" AS ENUM ('RESOLVED', 'UNRESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ProjectAhspSelectionMode" AS ENUM ('AUTO_SELECTED', 'USER_OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ProjectAhspResolutionMethod" AS ENUM ('EXACT_DETERMINISTIC', 'DETERMINISTIC_ATTEMPTED');

-- CreateTable
CREATE TABLE "project_ahsp_occurrences" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ahspVersionId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdByAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ahsp_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_ahsp_resource_resolutions" (
    "id" UUID NOT NULL,
    "occurrenceId" UUID NOT NULL,
    "ahspResourceId" UUID NOT NULL,
    "rawAhspResourceRef" TEXT NOT NULL,
    "rawAhspResourceType" TEXT NOT NULL,
    "ahspCoefficient" DECIMAL(18,6) NOT NULL,
    "ahspUnit" TEXT NOT NULL,
    "resourceCatalogId" UUID,
    "selectedBasicPriceId" UUID,
    "status" "ProjectAhspResolutionStatus" NOT NULL,
    "selectionMode" "ProjectAhspSelectionMode",
    "canonicalUnit" TEXT,
    "sourcePriceValue" DECIMAL(18,2),
    "sourceUnit" TEXT,
    "adaptedPriceValue" DECIMAL(18,2),
    "conversionFactor" DECIMAL(18,6),
    "selectedSourceOrigin" "PriceSourceOrigin",
    "selectedFreshnessStatus" "PriceFreshnessStatus",
    "selectedEffectiveDate" TIMESTAMP(3),
    "resolutionMethod" "ProjectAhspResolutionMethod" NOT NULL,
    "reasonCodes" TEXT[],
    "explanation" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ahsp_resource_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_ahsp_occurrences_workspaceId_idx" ON "project_ahsp_occurrences"("workspaceId");

-- CreateIndex
CREATE INDEX "project_ahsp_occurrences_projectId_idx" ON "project_ahsp_occurrences"("projectId");

-- CreateIndex
CREATE INDEX "project_ahsp_occurrences_ahspVersionId_idx" ON "project_ahsp_occurrences"("ahspVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "project_ahsp_occurrences_projectId_idempotencyKey_key" ON "project_ahsp_occurrences"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "project_ahsp_resource_resolutions_occurrenceId_idx" ON "project_ahsp_resource_resolutions"("occurrenceId");

-- CreateIndex
CREATE INDEX "project_ahsp_resource_resolutions_ahspResourceId_idx" ON "project_ahsp_resource_resolutions"("ahspResourceId");

-- CreateIndex
CREATE INDEX "project_ahsp_resource_resolutions_resourceCatalogId_idx" ON "project_ahsp_resource_resolutions"("resourceCatalogId");

-- CreateIndex
CREATE INDEX "project_ahsp_resource_resolutions_selectedBasicPriceId_idx" ON "project_ahsp_resource_resolutions"("selectedBasicPriceId");

-- CreateIndex
CREATE INDEX "project_ahsp_resource_resolutions_status_idx" ON "project_ahsp_resource_resolutions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pahr_occurrence_ahsp_resource_key" ON "project_ahsp_resource_resolutions"("occurrenceId", "ahspResourceId");

-- AddForeignKey
ALTER TABLE "project_ahsp_occurrences" ADD CONSTRAINT "project_ahsp_occurrences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ahsp_occurrences" ADD CONSTRAINT "project_ahsp_occurrences_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ahsp_occurrences" ADD CONSTRAINT "project_ahsp_occurrences_ahspVersionId_fkey" FOREIGN KEY ("ahspVersionId") REFERENCES "ahsp_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "project_ahsp_resource_resolutions_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "project_ahsp_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "project_ahsp_resource_resolutions_ahspResourceId_fkey" FOREIGN KEY ("ahspResourceId") REFERENCES "ahsp_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "project_ahsp_resource_resolutions_resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "project_ahsp_resource_resolutions_selectedBasicPriceId_fkey" FOREIGN KEY ("selectedBasicPriceId") REFERENCES "basic_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
