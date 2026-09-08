-- SHARED-OBSERVED-RESOURCE-01 — the one domain-neutral home for an observed,
-- not-yet-canonical resource. Additive only: one new table + one new enum, plus
-- two foreign keys onto tables that already exist (workspaces, resource_catalogs).
-- No existing table, column, or row is altered. Nothing here mints a resource;
-- canonical admission stays with ResourceAdmissionService (ResourceCatalog +
-- ResourceSourceIdentity), and a resolved catalog id is written only after a
-- human decision.

CREATE TYPE "ObservedResourceStatus" AS ENUM ('OBSERVED', 'RESOLVED_EXISTING', 'ADMITTED_NEW', 'DISMISSED');

CREATE TABLE "observed_resources" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawCode" TEXT,
    "rawUnit" TEXT,
    "resourceType" "ResourceType" NOT NULL,
    "sourceSha256" VARCHAR(64),
    "sourceFileName" TEXT,
    "parserContractVersion" TEXT,
    "sheetName" TEXT,
    "sourceRowNumber" INTEGER,
    "sourceCodeCellAddress" TEXT,
    "sourceNameCellAddress" TEXT,
    "sourceUnitCellAddress" TEXT,
    "candidatesJson" JSONB,
    "status" "ObservedResourceStatus" NOT NULL DEFAULT 'OBSERVED',
    "resolvedResourceCatalogId" UUID,
    "decidedByAccountId" UUID,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "observed_resources_pkey" PRIMARY KEY ("id")
);

-- One real source row is observed once; NULL provenance keeps hand-built rows
-- distinct (Postgres treats NULLs as distinct in a unique index), so only a
-- fully-located source row dedupes on re-import.
CREATE UNIQUE INDEX "observed_resources_dedupe_key" ON "observed_resources"("workspaceId", "sourceSha256", "sheetName", "sourceRowNumber", "rawName", "resourceType");
CREATE INDEX "observed_resources_workspaceId_status_idx" ON "observed_resources"("workspaceId", "status");

ALTER TABLE "observed_resources" ADD CONSTRAINT "observed_resources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "observed_resources" ADD CONSTRAINT "observed_resources_resolvedResourceCatalogId_fkey" FOREIGN KEY ("resolvedResourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
