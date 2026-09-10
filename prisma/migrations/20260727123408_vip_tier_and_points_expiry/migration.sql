-- AlterEnum
ALTER TYPE "PointsTransactionType" ADD VALUE 'EXPIRE';

-- AlterTable
ALTER TABLE "LoyaltyCustomer" ADD COLUMN     "lifetimePoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PointsTransaction" ADD COLUMN     "remainingPoints" INTEGER,
ADD COLUMN     "sourceTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "PointsTransaction_expiresAt_idx" ON "PointsTransaction"("expiresAt");

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "PointsTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
