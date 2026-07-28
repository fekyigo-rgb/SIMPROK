-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BasicPriceImportRowMappingSuggestionSource" ADD VALUE 'SOURCE_ROW_PROVENANCE';
ALTER TYPE "BasicPriceImportRowMappingSuggestionSource" ADD VALUE 'PROVENANCE_NAME_CONFLICT';

-- CreateTable
CREATE TABLE "basic_price_source_equivalences" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "batchSourceSha256" VARCHAR(64) NOT NULL,
    "canonicalSourceSha256" VARCHAR(64) NOT NULL,
    "evidence" TEXT NOT NULL,
    "comparedFields" TEXT[],
    "verifiedByAccountId" UUID NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "basic_price_source_equivalences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "basic_price_source_equivalences_workspaceId_idx" ON "basic_price_source_equivalences"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "basic_price_source_equivalences_workspaceId_batchSourceSha2_key" ON "basic_price_source_equivalences"("workspaceId", "batchSourceSha256");

-- AddForeignKey
ALTER TABLE "basic_price_source_equivalences" ADD CONSTRAINT "basic_price_source_equivalences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
