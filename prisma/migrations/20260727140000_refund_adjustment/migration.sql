-- AlterTable
ALTER TABLE "PointsTransaction" ADD COLUMN "shopifyRefundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_shopifyRefundId_type_key" ON "PointsTransaction"("shopifyRefundId", "type");
