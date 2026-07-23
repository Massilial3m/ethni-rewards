-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_shopifyOrderId_type_key" ON "PointsTransaction"("shopifyOrderId", "type");

