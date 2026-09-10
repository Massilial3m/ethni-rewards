-- AlterEnum
ALTER TYPE "PointsTransactionType" ADD VALUE 'EARN_ACTION';

-- CreateEnum
CREATE TYPE "SocialAction" AS ENUM ('INSTAGRAM_FOLLOW', 'TIKTOK_FOLLOW', 'FACEBOOK_FOLLOW', 'NEWSLETTER');

-- CreateEnum
CREATE TYPE "SocialActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SocialActionRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "action" "SocialAction" NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "SocialActionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "SocialActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialActionRequest_status_idx" ON "SocialActionRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialActionRequest_customerId_action_key" ON "SocialActionRequest"("customerId", "action");

-- AddForeignKey
ALTER TABLE "SocialActionRequest" ADD CONSTRAINT "SocialActionRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "LoyaltyCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
