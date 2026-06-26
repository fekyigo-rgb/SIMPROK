/*
  Warnings:

  - A unique constraint covering the columns `[sourceSubmissionId]` on the table `basic_prices` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PriceReviewActionType" AS ENUM ('ACCEPT', 'REQUEST_CORRECTION', 'REJECT', 'REASSIGN');

-- AlterTable
ALTER TABLE "basic_prices" ADD COLUMN     "organizationId" UUID;

-- AlterTable
ALTER TABLE "price_submissions" ADD COLUMN     "organizationId" UUID;

-- CreateTable
CREATE TABLE "price_submission_reviews" (
    "id" UUID NOT NULL,
    "priceSubmissionId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "slaState" "ReviewSlaState" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "assignedToUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_submission_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_submission_review_decisions" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "action" "PriceReviewActionType" NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_submission_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_submission_reviews_priceSubmissionId_key" ON "price_submission_reviews"("priceSubmissionId");

-- CreateIndex
CREATE INDEX "price_submission_reviews_workspaceId_organizationId_idx" ON "price_submission_reviews"("workspaceId", "organizationId");

-- CreateIndex
CREATE INDEX "price_submission_reviews_organizationId_idx" ON "price_submission_reviews"("organizationId");

-- CreateIndex
CREATE INDEX "price_submission_reviews_slaState_idx" ON "price_submission_reviews"("slaState");

-- CreateIndex
CREATE INDEX "price_submission_reviews_assignedToUserId_idx" ON "price_submission_reviews"("assignedToUserId");

-- CreateIndex
CREATE INDEX "price_submission_review_decisions_reviewId_idx" ON "price_submission_review_decisions"("reviewId");

-- CreateIndex
CREATE INDEX "price_submission_review_decisions_decidedByUserId_idx" ON "price_submission_review_decisions"("decidedByUserId");

-- CreateIndex
CREATE INDEX "price_submission_review_decisions_action_idx" ON "price_submission_review_decisions"("action");

-- CreateIndex
CREATE UNIQUE INDEX "basic_prices_sourceSubmissionId_key" ON "basic_prices"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "basic_prices_workspaceId_organizationId_idx" ON "basic_prices"("workspaceId", "organizationId");

-- CreateIndex
CREATE INDEX "basic_prices_organizationId_idx" ON "basic_prices"("organizationId");

-- CreateIndex
CREATE INDEX "price_submissions_workspaceId_organizationId_idx" ON "price_submissions"("workspaceId", "organizationId");

-- CreateIndex
CREATE INDEX "price_submissions_organizationId_idx" ON "price_submissions"("organizationId");

-- AddForeignKey
ALTER TABLE "price_submission_reviews" ADD CONSTRAINT "price_submission_reviews_priceSubmissionId_fkey" FOREIGN KEY ("priceSubmissionId") REFERENCES "price_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_reviews" ADD CONSTRAINT "price_submission_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_reviews" ADD CONSTRAINT "price_submission_reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_reviews" ADD CONSTRAINT "price_submission_reviews_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_review_decisions" ADD CONSTRAINT "price_submission_review_decisions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "price_submission_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_submission_review_decisions" ADD CONSTRAINT "price_submission_review_decisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
