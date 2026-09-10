-- AlterTable
ALTER TABLE "LoyaltyCustomer" ADD COLUMN "referralCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCustomer_referralCode_key" ON "LoyaltyCustomer"("referralCode");
