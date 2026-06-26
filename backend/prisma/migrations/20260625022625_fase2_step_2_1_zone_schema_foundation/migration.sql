-- CreateEnum
CREATE TYPE "IntakeJobStatus" AS ENUM ('QUEUED', 'EXTRACTING', 'UNDERSTANDING', 'VALIDATING', 'NEEDS_REVIEW', 'REVIEWING', 'PUBLISHED', 'FAILED', 'REVIEW_EXPIRED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "KnowledgeLifecycleStatus" AS ENUM ('CANDIDATE', 'VALIDATED', 'NEEDS_REVIEW', 'PUBLISHED', 'REJECTED', 'EXPIRED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('MATCHED', 'PARTIAL_MATCH', 'AMBIGUOUS', 'UNRESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ReviewSlaState" AS ENUM ('OPEN', 'ESCALATED', 'EXPIRED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewActionType" AS ENUM ('RESOLVE', 'REASSIGN_MEANING', 'REJECT', 'REQUEST_MORE');

-- CreateTable
CREATE TABLE "source_documents" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "uploadedByAccountId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_jobs" (
    "id" UUID NOT NULL,
    "sourceDocumentId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "IntakeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "lastCompletedStage" TEXT,
    "correlationId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_artifacts" (
    "id" UUID NOT NULL,
    "intakeJobId" UUID NOT NULL,
    "rawRows" JSONB NOT NULL,
    "detectedColumns" JSONB,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_price_points" (
    "id" UUID NOT NULL,
    "resourceRef" TEXT NOT NULL,
    "resourceCatalogId" UUID,
    "value" DECIMAL(18,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "sourceOrigin" "PriceSourceOrigin" NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_price_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_candidates" (
    "id" UUID NOT NULL,
    "intakeJobId" UUID NOT NULL,
    "extractionArtifactId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "knowledgeType" TEXT NOT NULL DEFAULT 'PRICE_POINT',
    "contextPath" TEXT,
    "canonicalPricePointId" UUID,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lifecycleStatus" "KnowledgeLifecycleStatus" NOT NULL DEFAULT 'CANDIDATE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_results" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" "ValidationStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "messages" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tasks" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "assignedToUserId" UUID,
    "slaState" "ReviewSlaState" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" UUID NOT NULL,
    "reviewTaskId" UUID NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "action" "ReviewActionType" NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_events" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "envelopeId" UUID NOT NULL,
    "knowledgeType" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "canonicalPricePointId" UUID,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByRef" TEXT NOT NULL,
    "provenanceChain" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "knowledge_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_documents_workspaceId_idx" ON "source_documents"("workspaceId");

-- CreateIndex
CREATE INDEX "source_documents_organizationId_idx" ON "source_documents"("organizationId");

-- CreateIndex
CREATE INDEX "source_documents_checksum_idx" ON "source_documents"("checksum");

-- CreateIndex
CREATE INDEX "intake_jobs_sourceDocumentId_idx" ON "intake_jobs"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "intake_jobs_workspaceId_idx" ON "intake_jobs"("workspaceId");

-- CreateIndex
CREATE INDEX "intake_jobs_status_idx" ON "intake_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "intake_jobs_idempotencyKey_key" ON "intake_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "extraction_artifacts_intakeJobId_idx" ON "extraction_artifacts"("intakeJobId");

-- CreateIndex
CREATE INDEX "canonical_price_points_resourceCatalogId_idx" ON "canonical_price_points"("resourceCatalogId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_candidates_canonicalPricePointId_key" ON "knowledge_candidates"("canonicalPricePointId");

-- CreateIndex
CREATE INDEX "knowledge_candidates_intakeJobId_idx" ON "knowledge_candidates"("intakeJobId");

-- CreateIndex
CREATE INDEX "knowledge_candidates_extractionArtifactId_idx" ON "knowledge_candidates"("extractionArtifactId");

-- CreateIndex
CREATE INDEX "knowledge_candidates_workspaceId_idx" ON "knowledge_candidates"("workspaceId");

-- CreateIndex
CREATE INDEX "knowledge_candidates_lifecycleStatus_idx" ON "knowledge_candidates"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "validation_results_candidateId_idx" ON "validation_results"("candidateId");

-- CreateIndex
CREATE INDEX "review_tasks_candidateId_idx" ON "review_tasks"("candidateId");

-- CreateIndex
CREATE INDEX "review_tasks_slaState_idx" ON "review_tasks"("slaState");

-- CreateIndex
CREATE INDEX "review_decisions_reviewTaskId_idx" ON "review_decisions"("reviewTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_events_sequence_key" ON "knowledge_events"("sequence");

-- CreateIndex
CREATE INDEX "knowledge_events_envelopeId_idx" ON "knowledge_events"("envelopeId");

-- CreateIndex
CREATE INDEX "knowledge_events_workspaceId_idx" ON "knowledge_events"("workspaceId");

-- CreateIndex
CREATE INDEX "knowledge_events_knowledgeType_idx" ON "knowledge_events"("knowledgeType");

-- AddForeignKey
ALTER TABLE "intake_jobs" ADD CONSTRAINT "intake_jobs_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_artifacts" ADD CONSTRAINT "extraction_artifacts_intakeJobId_fkey" FOREIGN KEY ("intakeJobId") REFERENCES "intake_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_price_points" ADD CONSTRAINT "canonical_price_points_resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_intakeJobId_fkey" FOREIGN KEY ("intakeJobId") REFERENCES "intake_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_extractionArtifactId_fkey" FOREIGN KEY ("extractionArtifactId") REFERENCES "extraction_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_canonicalPricePointId_fkey" FOREIGN KEY ("canonicalPricePointId") REFERENCES "canonical_price_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "knowledge_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "knowledge_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewTaskId_fkey" FOREIGN KEY ("reviewTaskId") REFERENCES "review_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_events" ADD CONSTRAINT "knowledge_events_canonicalPricePointId_fkey" FOREIGN KEY ("canonicalPricePointId") REFERENCES "canonical_price_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;
