-- AUTHORITY GOVERNANCE PROVENANCE (O1)
--
-- The governed, immutable history of an Authority being GRANTED to or REVOKED
-- from a Position. `position_authorities` remains the ONLY current-state
-- relation the authority resolver reads; this table never decides an
-- entitlement and is never read by that resolver.
--
-- Generated with `prisma migrate diff`. Five statements the diff also emitted
-- were DELIBERATELY EXCLUDED because they are pre-existing drift unrelated to
-- this capability, and two of them touch AHSP tables this gate freezes:
--   ALTER TABLE "basic_price_provenance_corrections" ... DROP DEFAULT
--   ALTER TABLE "project_time_zone_events" ... DROP DEFAULT
--   ALTER INDEX "ahsp_resource_identity_decisions_subject_generation_key" RENAME ...
--   ALTER INDEX "ahsp_resource_identity_decisions_subject_latest_idx" RENAME ...
--   ALTER INDEX "project_ahsp_occurrences_context_generation_idx" RENAME ...
-- Every statement below touches only this new table and its own enum.

-- CreateEnum
CREATE TYPE "AuthorityGovernanceAction" AS ENUM ('GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "authority_governance_decisions" (
    "id" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "authorityId" UUID NOT NULL,
    "action" "AuthorityGovernanceAction" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "previousDecisionId" UUID,
    "executedByAccountId" UUID NOT NULL,
    "ownerAuthorizationReference" TEXT NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "commandFingerprint" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_governance_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "authority_governance_decisions_idempotencyKey_key" ON "authority_governance_decisions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "authority_governance_decisions_positionId_authorityId_gener_idx" ON "authority_governance_decisions"("positionId", "authorityId", "generation" DESC);

-- CreateIndex
CREATE INDEX "authority_governance_decisions_authorityId_idx" ON "authority_governance_decisions"("authorityId");

-- CreateIndex
CREATE UNIQUE INDEX "authority_governance_decisions_positionId_authorityId_gener_key" ON "authority_governance_decisions"("positionId", "authorityId", "generation");

-- AddForeignKey
ALTER TABLE "authority_governance_decisions" ADD CONSTRAINT "authority_governance_decisions_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_governance_decisions" ADD CONSTRAINT "authority_governance_decisions_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_governance_decisions" ADD CONSTRAINT "authority_governance_decisions_executedByAccountId_fkey" FOREIGN KEY ("executedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_governance_decisions" ADD CONSTRAINT "authority_governance_decisions_previousDecisionId_fkey" FOREIGN KEY ("previousDecisionId") REFERENCES "authority_governance_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
