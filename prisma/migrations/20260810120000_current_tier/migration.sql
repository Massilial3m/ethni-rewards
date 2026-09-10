-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- AlterTable
ALTER TABLE "LoyaltyCustomer" ADD COLUMN "currentTier" "LoyaltyTier";
