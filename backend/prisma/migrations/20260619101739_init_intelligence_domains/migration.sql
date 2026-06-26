-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "PriceSourceType" AS ENUM ('VENDOR_QUOTE', 'MARKET_SURVEY', 'REGULATION', 'SYSTEM_ESTIMATE');

-- CreateEnum
CREATE TYPE "PriceConfidence" AS ENUM ('C1', 'C2', 'C4');

-- CreateEnum
CREATE TYPE "BoqItemType" AS ENUM ('FOLDER', 'WORK_ITEM');

-- CreateEnum
CREATE TYPE "DeviationType" AS ENUM ('PRICE', 'QUANTITY', 'PRODUCTIVITY', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "SeverityLevel" AS ENUM ('NORMAL', 'WATCH', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PriorityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TrendDirection" AS ENUM ('IMPROVING', 'STABLE', 'DEGRADING', 'VOLATILE');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('COST', 'SCHEDULE', 'SCOPE', 'QUALITY');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('IDENTIFIED', 'MITIGATING', 'RESOLVED', 'MATERIALIZED');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "RecommendationTrigger" AS ENUM ('RISK', 'FORECAST', 'DEVIATION', 'PATTERN');

-- CreateEnum
CREATE TYPE "RecommendationCategory" AS ENUM ('COST_RECOVERY', 'SCHEDULE_RECOVERY', 'RISK_MITIGATION', 'OPPORTUNITY', 'STRATEGIC_SIGNAL');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('GENERATED', 'VIEWED', 'ACTED_ON', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('RECORDED', 'EXECUTING', 'COMPLETED');

-- CreateTable
CREATE TABLE "authorities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_authorities" (
    "id" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "authorityId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_catalogs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "specifications" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basic_prices" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "workspaceId" UUID,
    "regionId" UUID,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "sourceType" "PriceSourceType" NOT NULL DEFAULT 'SYSTEM_ESTIMATE',
    "confidence" "PriceConfidence" NOT NULL DEFAULT 'C1',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "basic_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_structures" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" UUID NOT NULL,
    "boqStructureId" UUID NOT NULL,
    "parentId" UUID,
    "wbsCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "BoqItemType" NOT NULL DEFAULT 'WORK_ITEM',
    "quantity" DECIMAL(18,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "ahspVersionId" UUID,
    "ahspSnapshotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aHSPId" UUID,

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rab_documents" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqStructureId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "overheadPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "profitPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "totalBaseCost" DECIMAL(18,2) NOT NULL,
    "totalFinalCost" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rab_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_baselines" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "rabDocumentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "approvedByPositionId" UUID,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_reports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "baselineId" UUID NOT NULL,
    "periodStartDate" TIMESTAMP(3) NOT NULL,
    "periodEndDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_entries" (
    "id" UUID NOT NULL,
    "progressReportId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "installedQuantity" DECIMAL(18,2) NOT NULL,
    "actualCost" DECIMAL(18,2) NOT NULL,
    "earnedValue" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progress_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deviation_signals" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "progressReportId" UUID NOT NULL,
    "type" "DeviationType" NOT NULL,
    "severity" "SeverityLevel" NOT NULL DEFAULT 'NORMAL',
    "cpi" DECIMAL(10,4),
    "spi" DECIMAL(10,4),
    "trend" "TrendDirection" NOT NULL DEFAULT 'STABLE',
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deviation_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_risks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "deviationSignalId" UUID,
    "category" "RiskCategory" NOT NULL,
    "probability" DECIMAL(4,3) NOT NULL,
    "impact" DECIMAL(4,3) NOT NULL,
    "riskScore" DECIMAL(4,3) NOT NULL,
    "classification" "PriorityLevel" NOT NULL DEFAULT 'LOW',
    "status" "RiskStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "escalatedToPositionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_forecasts" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "progressReportId" UUID NOT NULL,
    "eacCost" DECIMAL(18,2) NOT NULL,
    "etcCost" DECIMAL(18,2) NOT NULL,
    "projectedEndDate" TIMESTAMP(3) NOT NULL,
    "confidenceLevel" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "triggerType" "RecommendationTrigger" NOT NULL,
    "triggerId" UUID NOT NULL,
    "category" "RecommendationCategory" NOT NULL,
    "context" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "urgency" "PriorityLevel" NOT NULL DEFAULT 'LOW',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_options" (
    "id" UUID NOT NULL,
    "recommendationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal_decisions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "recommendationId" UUID,
    "decidedByUserId" UUID NOT NULL,
    "decidedByPositionId" UUID,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'RECORDED',
    "actualOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formal_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authorities_code_key" ON "authorities"("code");

-- CreateIndex
CREATE INDEX "position_authorities_positionId_idx" ON "position_authorities"("positionId");

-- CreateIndex
CREATE INDEX "position_authorities_authorityId_idx" ON "position_authorities"("authorityId");

-- CreateIndex
CREATE UNIQUE INDEX "position_authorities_positionId_authorityId_key" ON "position_authorities"("positionId", "authorityId");

-- CreateIndex
CREATE INDEX "resource_catalogs_workspaceId_idx" ON "resource_catalogs"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_catalogs_workspaceId_code_key" ON "resource_catalogs"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "basic_prices_resourceId_idx" ON "basic_prices"("resourceId");

-- CreateIndex
CREATE INDEX "basic_prices_workspaceId_idx" ON "basic_prices"("workspaceId");

-- CreateIndex
CREATE INDEX "boq_structures_projectId_idx" ON "boq_structures"("projectId");

-- CreateIndex
CREATE INDEX "boq_items_boqStructureId_idx" ON "boq_items"("boqStructureId");

-- CreateIndex
CREATE INDEX "boq_items_parentId_idx" ON "boq_items"("parentId");

-- CreateIndex
CREATE INDEX "rab_documents_projectId_idx" ON "rab_documents"("projectId");

-- CreateIndex
CREATE INDEX "project_baselines_projectId_idx" ON "project_baselines"("projectId");

-- CreateIndex
CREATE INDEX "progress_reports_projectId_idx" ON "progress_reports"("projectId");

-- CreateIndex
CREATE INDEX "progress_entries_progressReportId_idx" ON "progress_entries"("progressReportId");

-- CreateIndex
CREATE INDEX "deviation_signals_projectId_idx" ON "deviation_signals"("projectId");

-- CreateIndex
CREATE INDEX "project_risks_projectId_idx" ON "project_risks"("projectId");

-- CreateIndex
CREATE INDEX "project_forecasts_projectId_idx" ON "project_forecasts"("projectId");

-- CreateIndex
CREATE INDEX "recommendations_projectId_idx" ON "recommendations"("projectId");

-- CreateIndex
CREATE INDEX "recommendation_options_recommendationId_idx" ON "recommendation_options"("recommendationId");

-- CreateIndex
CREATE INDEX "formal_decisions_projectId_idx" ON "formal_decisions"("projectId");

-- AddForeignKey
ALTER TABLE "position_authorities" ADD CONSTRAINT "position_authorities_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_authorities" ADD CONSTRAINT "position_authorities_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "authorities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_catalogs" ADD CONSTRAINT "resource_catalogs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resource_catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_structures" ADD CONSTRAINT "boq_structures_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_boqStructureId_fkey" FOREIGN KEY ("boqStructureId") REFERENCES "boq_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "boq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_ahspVersionId_fkey" FOREIGN KEY ("ahspVersionId") REFERENCES "ahsp_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_ahspSnapshotId_fkey" FOREIGN KEY ("ahspSnapshotId") REFERENCES "ahsp_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_aHSPId_fkey" FOREIGN KEY ("aHSPId") REFERENCES "ahsps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_documents" ADD CONSTRAINT "rab_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rab_documents" ADD CONSTRAINT "rab_documents_boqStructureId_fkey" FOREIGN KEY ("boqStructureId") REFERENCES "boq_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_rabDocumentId_fkey" FOREIGN KEY ("rabDocumentId") REFERENCES "rab_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_approvedByPositionId_fkey" FOREIGN KEY ("approvedByPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "project_baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_progressReportId_fkey" FOREIGN KEY ("progressReportId") REFERENCES "progress_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation_signals" ADD CONSTRAINT "deviation_signals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation_signals" ADD CONSTRAINT "deviation_signals_progressReportId_fkey" FOREIGN KEY ("progressReportId") REFERENCES "progress_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_deviationSignalId_fkey" FOREIGN KEY ("deviationSignalId") REFERENCES "deviation_signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_escalatedToPositionId_fkey" FOREIGN KEY ("escalatedToPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forecasts" ADD CONSTRAINT "project_forecasts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forecasts" ADD CONSTRAINT "project_forecasts_progressReportId_fkey" FOREIGN KEY ("progressReportId") REFERENCES "progress_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_options" ADD CONSTRAINT "recommendation_options_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal_decisions" ADD CONSTRAINT "formal_decisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal_decisions" ADD CONSTRAINT "formal_decisions_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal_decisions" ADD CONSTRAINT "formal_decisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal_decisions" ADD CONSTRAINT "formal_decisions_decidedByPositionId_fkey" FOREIGN KEY ("decidedByPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
