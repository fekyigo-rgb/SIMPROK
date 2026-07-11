-- CreateEnum
CREATE TYPE "IntelligenceEvidenceStatus" AS ENUM ('READY', 'PARTIAL', 'NEEDS_REVIEW', 'REJECTED_BY_POLICY', 'PROVIDER_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "IntelligenceEfPermission" AS ENUM ('ALLOWED', 'NOT_ALLOWED', 'SELECTED_ITEMS_ONLY');

-- CreateTable
CREATE TABLE "intelligence_evidence" (
    "id" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "providerIdentifier" TEXT,
    "modelIdentifier" TEXT,
    "policyVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" "IntelligenceEvidenceStatus" NOT NULL,
    "sourceReferences" TEXT[],
    "toolsRequested" TEXT[],
    "toolsAllowed" TEXT[],
    "toolsDenied" TEXT[],
    "selectedAhspIds" TEXT[],
    "selectedBasicPriceIds" TEXT[],
    "efPermission" "IntelligenceEfPermission" NOT NULL,
    "efReferences" TEXT[],
    "confidence" DOUBLE PRECISION,
    "reasonCodes" TEXT[],
    "policyRejections" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intelligence_evidence_requestId_idx" ON "intelligence_evidence"("requestId");

-- CreateIndex
CREATE INDEX "intelligence_evidence_workspaceId_organizationId_createdAt_idx" ON "intelligence_evidence"("workspaceId", "organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "intelligence_evidence_projectId_createdAt_idx" ON "intelligence_evidence"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "intelligence_evidence_accountId_createdAt_idx" ON "intelligence_evidence"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "intelligence_evidence_createdAt_idx" ON "intelligence_evidence"("createdAt");

-- AddForeignKey
ALTER TABLE "intelligence_evidence" ADD CONSTRAINT "intelligence_evidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_evidence" ADD CONSTRAINT "intelligence_evidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_evidence" ADD CONSTRAINT "intelligence_evidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_evidence" ADD CONSTRAINT "intelligence_evidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
