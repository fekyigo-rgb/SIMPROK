-- CreateEnum
CREATE TYPE "PriceSubmissionStatus" AS ENUM ('SUBMITTED', 'NEEDS_CORRECTION', 'RESUBMITTED', 'ACCEPTED', 'UNDER_REVIEW', 'VERIFIED', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PriceSubmissionActorType" AS ENUM ('SYSTEM', 'HUMAN');

-- AlterTable
ALTER TABLE "basic_prices" ADD COLUMN     "sourceSubmissionId" UUID;

-- CreateTable
CREATE TABLE "price_submissions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "resourceId" UUID NOT NULL,
    "regionId" UUID,
    "reportedByAccountId" UUID,
    "sourceOrigin" "PriceSourceOrigin" NOT NULL,
    "sourceType" "PriceSourceType" NOT NULL DEFAULT 'MARKET_SURVEY',
    "status" "PriceSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "currentRevisionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_submission_revisions" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "photoUrl" TEXT,
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "note" TEXT,
    "validationPassed" BOOLEAN NOT NULL DEFAULT false,
    "validationMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_submission_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_submission_audits" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "fromStatus" "PriceSubmissionStatus",
    "toStatus" "PriceSubmissionStatus" NOT NULL,
    "actorType" "PriceSubmissionActorType" NOT NULL,
    "actorAccountId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_submission_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_submissions_workspaceId_idx" ON "price_submissions"("workspaceId");

-- CreateIndex
CREATE INDEX "price_submissions_resourceId_idx" ON "price_submissions"("resourceId");

-- CreateIndex
CREATE INDEX "price_submissions_reportedByAccountId_idx" ON "price_submissions"("reportedByAccountId");

-- CreateIndex
CREATE INDEX "price_submissions_status_idx" ON "price_submissions"("status");

-- CreateIndex
CREATE INDEX "price_submission_revisions_submissionId_idx" ON "price_submission_revisions"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "price_submission_revisions_submissionId_revisionNumber_key" ON "price_submission_revisions"("submissionId", "revisionNumber");

-- CreateIndex
CREATE INDEX "price_submission_audits_submissionId_idx" ON "price_submission_audits"("submissionId");

-- CreateIndex
CREATE INDEX "basic_prices_sourceSubmissionId_idx" ON "basic_prices"("sourceSubmissionId");

-- AddForeignKey
ALTER TABLE "price_submissions" ADD CONSTRAINT "price_submissions_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resource_catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submissions" ADD CONSTRAINT "price_submissions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_revisions" ADD CONSTRAINT "price_submission_revisions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "price_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_audits" ADD CONSTRAINT "price_submission_audits_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "price_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_prices" ADD CONSTRAINT "basic_prices_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "price_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
