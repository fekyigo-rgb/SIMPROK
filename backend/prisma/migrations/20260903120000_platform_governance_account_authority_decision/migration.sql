-- CreateEnum
CREATE TYPE "PlatformGovernanceDecisionType" AS ENUM ('GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "platform_governance_decisions" (
    "id" UUID NOT NULL,
    "holderAccountId" UUID NOT NULL,
    "authorityId" UUID NOT NULL,
    "decision" "PlatformGovernanceDecisionType" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "previousDecisionId" UUID,
    "executedByAccountId" UUID NOT NULL,
    "ownerAuthorizationReference" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "commandFingerprint" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "platform_governance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_governance_decisions_idempotencyKey_key" ON "platform_governance_decisions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "platform_governance_decisions_holderAccountId_authorityId_g_idx" ON "platform_governance_decisions"("holderAccountId", "authorityId", "generation" DESC);

-- CreateIndex
CREATE INDEX "platform_governance_decisions_authorityId_idx" ON "platform_governance_decisions"("authorityId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_governance_decisions_holderAccountId_authorityId_g_key" ON "platform_governance_decisions"("holderAccountId", "authorityId", "generation");

-- AddForeignKey
ALTER TABLE "platform_governance_decisions" ADD CONSTRAINT "platform_governance_decisions_holderAccountId_fkey" FOREIGN KEY ("holderAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_governance_decisions" ADD CONSTRAINT "platform_governance_decisions_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_governance_decisions" ADD CONSTRAINT "platform_governance_decisions_executedByAccountId_fkey" FOREIGN KEY ("executedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_governance_decisions" ADD CONSTRAINT "platform_governance_decisions_previousDecisionId_fkey" FOREIGN KEY ("previousDecisionId") REFERENCES "platform_governance_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
