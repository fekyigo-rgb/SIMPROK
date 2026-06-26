-- CreateEnum
CREATE TYPE "MethodType" AS ENUM ('MANUAL', 'MECHANICAL', 'SEMI_MECHANICAL', 'CHEMICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('GENERAL', 'URBAN', 'RURAL', 'MOUNTAIN', 'SWAMP', 'COASTAL', 'OFFSHORE', 'OTHER');

-- CreateEnum
CREATE TYPE "AhspVersionStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'VERIFIED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('OFFICIAL', 'WORKSPACE', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'PARTIAL_SUCCESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ahsps" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "workType" TEXT NOT NULL,
    "methodType" "MethodType" NOT NULL,
    "locationType" "LocationType" NOT NULL,
    "methodName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_versions" (
    "id" UUID NOT NULL,
    "ahspId" UUID NOT NULL,
    "workspaceId" UUID,
    "versionNumber" INTEGER NOT NULL,
    "status" "AhspVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "expiredDate" TIMESTAMP(3),
    "regulationReference" TEXT,
    "regulationPage" TEXT,
    "regulationSection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_resources" (
    "id" UUID NOT NULL,
    "ahspVersionId" UUID NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "coefficient" DECIMAL(18,6) NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "conversionFactor" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_source_documents" (
    "id" UUID NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_import_jobs" (
    "id" UUID NOT NULL,
    "ahspId" UUID,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_import_lines" (
    "id" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_import_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_import_evidences" (
    "id" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "sourcePage" TEXT,
    "sourceTable" TEXT,
    "sourceRow" TEXT,
    "rawCoefficient" TEXT,
    "rawUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ahsp_import_evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_snapshots" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "sourceAhspId" UUID NOT NULL,
    "sourceVersionId" UUID NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workType" TEXT NOT NULL,
    "methodType" "MethodType" NOT NULL,
    "locationType" "LocationType" NOT NULL,
    "methodName" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_snapshot_resources" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "coefficient" DECIMAL(18,6) NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "conversionFactor" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_snapshot_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_audit_logs" (
    "id" UUID NOT NULL,
    "ahspId" UUID NOT NULL,
    "ahspVersionId" UUID,
    "action" TEXT NOT NULL,
    "who" TEXT NOT NULL,
    "when" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "ahsp_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ahsps_workspaceId_idx" ON "ahsps"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ahsps_workspaceId_workType_methodType_locationType_methodNa_key" ON "ahsps"("workspaceId", "workType", "methodType", "locationType", "methodName");

-- CreateIndex
CREATE INDEX "ahsp_versions_ahspId_idx" ON "ahsp_versions"("ahspId");

-- CreateIndex
CREATE INDEX "ahsp_versions_workspaceId_idx" ON "ahsp_versions"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ahsp_versions_ahspId_versionNumber_key" ON "ahsp_versions"("ahspId", "versionNumber");

-- CreateIndex
CREATE INDEX "ahsp_resources_ahspVersionId_idx" ON "ahsp_resources"("ahspVersionId");

-- CreateIndex
CREATE INDEX "ahsp_resources_resourceId_idx" ON "ahsp_resources"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ahsp_import_jobs_idempotencyKey_key" ON "ahsp_import_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ahsp_import_jobs_ahspId_idx" ON "ahsp_import_jobs"("ahspId");

-- CreateIndex
CREATE INDEX "ahsp_import_lines_importJobId_idx" ON "ahsp_import_lines"("importJobId");

-- CreateIndex
CREATE INDEX "ahsp_import_evidences_importJobId_idx" ON "ahsp_import_evidences"("importJobId");

-- CreateIndex
CREATE INDEX "ahsp_snapshots_workspaceId_idx" ON "ahsp_snapshots"("workspaceId");

-- CreateIndex
CREATE INDEX "ahsp_snapshots_sourceAhspId_idx" ON "ahsp_snapshots"("sourceAhspId");

-- CreateIndex
CREATE INDEX "ahsp_snapshots_sourceVersionId_idx" ON "ahsp_snapshots"("sourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ahsp_snapshots_sourceAhspId_sourceVersionId_snapshotDate_key" ON "ahsp_snapshots"("sourceAhspId", "sourceVersionId", "snapshotDate");

-- CreateIndex
CREATE INDEX "ahsp_snapshot_resources_snapshotId_idx" ON "ahsp_snapshot_resources"("snapshotId");

-- CreateIndex
CREATE INDEX "ahsp_audit_logs_ahspId_idx" ON "ahsp_audit_logs"("ahspId");

-- CreateIndex
CREATE INDEX "ahsp_audit_logs_ahspVersionId_idx" ON "ahsp_audit_logs"("ahspVersionId");

-- AddForeignKey
ALTER TABLE "ahsps" ADD CONSTRAINT "ahsps_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_versions" ADD CONSTRAINT "ahsp_versions_ahspId_fkey" FOREIGN KEY ("ahspId") REFERENCES "ahsps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_versions" ADD CONSTRAINT "ahsp_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_resources" ADD CONSTRAINT "ahsp_resources_ahspVersionId_fkey" FOREIGN KEY ("ahspVersionId") REFERENCES "ahsp_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_import_jobs" ADD CONSTRAINT "ahsp_import_jobs_ahspId_fkey" FOREIGN KEY ("ahspId") REFERENCES "ahsps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_import_lines" ADD CONSTRAINT "ahsp_import_lines_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ahsp_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_import_evidences" ADD CONSTRAINT "ahsp_import_evidences_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ahsp_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_snapshots" ADD CONSTRAINT "ahsp_snapshots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_snapshots" ADD CONSTRAINT "ahsp_snapshots_sourceAhspId_fkey" FOREIGN KEY ("sourceAhspId") REFERENCES "ahsps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_snapshots" ADD CONSTRAINT "ahsp_snapshots_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "ahsp_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_snapshot_resources" ADD CONSTRAINT "ahsp_snapshot_resources_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ahsp_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_audit_logs" ADD CONSTRAINT "ahsp_audit_logs_ahspId_fkey" FOREIGN KEY ("ahspId") REFERENCES "ahsps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_audit_logs" ADD CONSTRAINT "ahsp_audit_logs_ahspVersionId_fkey" FOREIGN KEY ("ahspVersionId") REFERENCES "ahsp_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create Partial Unique Index for Official Repository
CREATE UNIQUE INDEX "ahsps_official_unique" ON "ahsps" ("workType", "methodType", "locationType", "methodName") WHERE "workspaceId" IS NULL;
