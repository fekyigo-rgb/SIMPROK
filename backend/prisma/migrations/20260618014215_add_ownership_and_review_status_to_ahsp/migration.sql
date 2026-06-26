-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('SIMPROK_ASSET', 'APPROVED_COMMUNITY_ASSET', 'USER_ASSET');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ahsps" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByEmail" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "approvedByUserId" UUID,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByEmail" TEXT,
ADD COLUMN     "archivedByName" TEXT,
ADD COLUMN     "archivedByUserId" UUID,
ADD COLUMN     "createdByUserId" UUID,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByEmail" TEXT,
ADD COLUMN     "deletedByName" TEXT,
ADD COLUMN     "deletedByUserId" UUID,
ADD COLUMN     "ownershipTransferredAt" TIMESTAMP(3),
ADD COLUMN     "ownershipTransferredByEmail" TEXT,
ADD COLUMN     "ownershipTransferredByName" TEXT,
ADD COLUMN     "ownershipTransferredByUserId" UUID,
ADD COLUMN     "ownershipType" "OwnershipType" NOT NULL DEFAULT 'USER_ASSET',
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "ahsps_ownershipType_idx" ON "ahsps"("ownershipType");

-- CreateIndex
CREATE INDEX "ahsps_reviewStatus_idx" ON "ahsps"("reviewStatus");

-- CreateIndex
CREATE INDEX "ahsps_workspaceId_ownershipType_idx" ON "ahsps"("workspaceId", "ownershipType");

-- CreateIndex
CREATE INDEX "ahsps_workspaceId_reviewStatus_idx" ON "ahsps"("workspaceId", "reviewStatus");

-- CreateIndex
CREATE INDEX "ahsps_deletedAt_idx" ON "ahsps"("deletedAt");

-- CreateIndex
CREATE INDEX "ahsps_archivedAt_idx" ON "ahsps"("archivedAt");

-- AddForeignKey
ALTER TABLE "ahsps" ADD CONSTRAINT "ahsps_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsps" ADD CONSTRAINT "ahsps_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsps" ADD CONSTRAINT "ahsps_ownershipTransferredByUserId_fkey" FOREIGN KEY ("ownershipTransferredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsps" ADD CONSTRAINT "ahsps_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsps" ADD CONSTRAINT "ahsps_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
