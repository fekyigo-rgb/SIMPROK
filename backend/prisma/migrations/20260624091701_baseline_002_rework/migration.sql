/*
  Warnings:

  - The values [PLANNING,TENDERING,EXECUTION,SUSPENDED] on the enum `ProjectStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `authorityCode` on the `approval_matrices` table. All the data in the column will be lost.
  - You are about to drop the column `confidence` on the `basic_prices` table. All the data in the column will be lost.
  - You are about to drop the column `aHSPId` on the `boq_items` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `project_assignments` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `project_assignments` table. All the data in the column will be lost.
  - You are about to alter the column `impact` on the `project_risks` table. The data in that column could be lost. The data in that column will be cast from `Decimal(4,3)` to `Decimal(18,2)`.
  - You are about to alter the column `riskScore` on the `project_risks` table. The data in that column could be lost. The data in that column will be cast from `Decimal(4,3)` to `Decimal(18,2)`.
  - You are about to drop the `project_teams` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[workspaceMembershipId,projectId]` on the table `project_assignments` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `authorityId` to the `approval_matrices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `roleInProject` to the `project_assignments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `workspaceMembershipId` to the `project_assignments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organizationId` to the `projects` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('GENERAL', 'EPCC', 'CONSTRUCTION_ONLY', 'DESIGN_ONLY', 'RENOVATION');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'INACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "WbsNodeType" AS ENUM ('LOCATION', 'ELEMENT', 'WORK_ITEM');

-- CreateEnum
CREATE TYPE "PriceVerificationStatus" AS ENUM ('UNVERIFIED', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PriceSourceOrigin" AS ENUM ('GOVERNMENT', 'SUPPLIER', 'STORE', 'DISTRIBUTOR', 'FIELD_REPORT', 'COMMUNITY_REPORT');

-- CreateEnum
CREATE TYPE "PriceFreshnessStatus" AS ENUM ('CURRENT', 'EXPIRING', 'EXPIRED');

-- AlterEnum
BEGIN;
CREATE TYPE "ProjectStatus_new" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED', 'CANCELLED');
ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "status" TYPE "ProjectStatus_new" USING ("status"::text::"ProjectStatus_new");
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "ProjectStatus_old";
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'PLANNED';
COMMIT;

-- DropForeignKey
ALTER TABLE "boq_items" DROP CONSTRAINT "boq_items_aHSPId_fkey";

-- DropForeignKey
ALTER TABLE "project_assignments" DROP CONSTRAINT "project_assignments_userId_fkey";

-- DropForeignKey
ALTER TABLE "project_teams" DROP CONSTRAINT "project_teams_projectId_fkey";

-- DropForeignKey
ALTER TABLE "project_teams" DROP CONSTRAINT "project_teams_userId_fkey";

-- DropIndex
DROP INDEX "project_assignments_userId_idx";

-- DropIndex
DROP INDEX "project_assignments_userId_projectId_key";

-- AlterTable
ALTER TABLE "approval_matrices" DROP COLUMN "authorityCode",
ADD COLUMN     "authorityId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "basic_prices" DROP COLUMN "confidence",
ADD COLUMN     "freshnessStatus" "PriceFreshnessStatus" NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "reportedByAccountId" UUID,
ADD COLUMN     "reviewDate" TIMESTAMP(3),
ADD COLUMN     "sourceOrigin" "PriceSourceOrigin" NOT NULL DEFAULT 'SUPPLIER',
ADD COLUMN     "validUntil" TIMESTAMP(3),
ADD COLUMN     "verificationStatus" "PriceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- AlterTable
ALTER TABLE "boq_items" DROP COLUMN "aHSPId",
ADD COLUMN     "wbsNodeId" UUID;

-- AlterTable
ALTER TABLE "boq_structures" ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "progress_entries" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "workDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "progress_reports" ADD COLUMN     "overallActualCost" DECIMAL(18,2),
ADD COLUMN     "overallActualProgress" DECIMAL(5,2),
ADD COLUMN     "overallPlannedCost" DECIMAL(18,2),
ADD COLUMN     "overallPlannedProgress" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "project_assignments" DROP COLUMN "isActive",
DROP COLUMN "userId",
ADD COLUMN     "isPrimaryAssignment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roleInProject" TEXT NOT NULL,
ADD COLUMN     "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
ADD COLUMN     "workspaceMembershipId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "project_risks" ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Identified Risk',
ALTER COLUMN "impact" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "riskScore" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "address" JSONB,
ADD COLUMN     "budgetBaseline" DECIMAL(18,2),
ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "organizationId" UUID NOT NULL,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "type" "ProjectType" NOT NULL DEFAULT 'GENERAL',
ALTER COLUMN "status" SET DEFAULT 'PLANNED';

-- AlterTable
ALTER TABLE "rab_documents" ADD COLUMN     "businessLabel" TEXT,
ADD COLUMN     "documentType" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "resource_catalogs" ADD COLUMN     "tkdnValue" DECIMAL(5,2);

-- DropTable
DROP TABLE "project_teams";

-- DropEnum
DROP TYPE "PriceConfidence";

-- CreateTable
CREATE TABLE "wbs_nodes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "parentId" UUID,
    "nodeType" "WbsNodeType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wbs_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wbs_nodes_projectId_idx" ON "wbs_nodes"("projectId");

-- CreateIndex
CREATE INDEX "wbs_nodes_parentId_idx" ON "wbs_nodes"("parentId");

-- CreateIndex
CREATE INDEX "approval_matrices_authorityId_idx" ON "approval_matrices"("authorityId");

-- CreateIndex
CREATE INDEX "boq_items_wbsNodeId_idx" ON "boq_items"("wbsNodeId");

-- CreateIndex
CREATE INDEX "project_assignments_workspaceMembershipId_idx" ON "project_assignments"("workspaceMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "project_assignments_workspaceMembershipId_projectId_key" ON "project_assignments"("workspaceMembershipId", "projectId");

-- CreateIndex
CREATE INDEX "projects_organizationId_idx" ON "projects"("organizationId");

-- AddForeignKey
ALTER TABLE "approval_matrices" ADD CONSTRAINT "approval_matrices_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_workspaceMembershipId_fkey" FOREIGN KEY ("workspaceMembershipId") REFERENCES "workspace_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "wbs_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "wbs_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
