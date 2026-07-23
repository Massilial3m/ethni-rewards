-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('EARN_WELCOME', 'EARN_ORDER', 'REDEEM', 'ADJUST_REFUND');

-- CreateTable
CREATE TABLE "LoyaltyCustomer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "points" INTEGER NOT NULL,
    "shopifyOrderId" TEXT,
    "discountCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCustomer_shop_shopifyCustomerId_key" ON "LoyaltyCustomer"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "PointsTransaction_customerId_idx" ON "PointsTransaction"("customerId");

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "LoyaltyCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
