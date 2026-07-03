-- AlterEnum
ALTER TYPE "BoqItemType" ADD VALUE 'NOTE';

-- AlterTable
ALTER TABLE "boq_items" ADD COLUMN     "lineTotal" DECIMAL(18,2),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unitPrice" DECIMAL(18,2);
