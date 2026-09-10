-- AlterEnum
ALTER TYPE "PointsTransactionType" ADD VALUE 'MILESTONE_REWARD';

-- AlterTable
ALTER TABLE "PointsTransaction" ADD COLUMN "milestonePoints" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_customerId_milestonePoints_type_key" ON "PointsTransaction"("customerId", "milestonePoints", "type");
