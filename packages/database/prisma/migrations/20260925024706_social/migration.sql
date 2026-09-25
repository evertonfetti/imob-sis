-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SocialTargetStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- AlterTable
ALTER TABLE "property_media" ADD COLUMN     "socialKey" TEXT;

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "pictureUrl" TEXT,
    "pageId" TEXT,
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'PENDING',
    "secrets" TEXT NOT NULL,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdById" TEXT,
    "caption" TEXT NOT NULL,
    "mediaIds" TEXT[],
    "status" "SocialPostStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post_targets" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "SocialTargetStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "social_post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_accounts_companyId_status_idx" ON "social_accounts"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_companyId_provider_externalId_key" ON "social_accounts"("companyId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "social_posts_status_scheduledAt_idx" ON "social_posts"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_posts_companyId_scheduledAt_idx" ON "social_posts"("companyId", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_posts_propertyId_idx" ON "social_posts"("propertyId");

-- CreateIndex
CREATE INDEX "social_post_targets_status_nextAttemptAt_idx" ON "social_post_targets"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_targets_postId_accountId_key" ON "social_post_targets"("postId", "accountId");

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
