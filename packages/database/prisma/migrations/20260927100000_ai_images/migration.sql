-- IA de imagens (versões aprovadas pelo usuário) e marca d'água nas fotos.
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'AI_IMAGE';

CREATE TYPE "AiOperation" AS ENUM ('ENHANCE', 'LIGHTING', 'REMOVE_OBJECT', 'REMOVE_FURNITURE', 'VIRTUAL_STAGE', 'SKY_REPLACEMENT');
CREATE TYPE "AiGenerationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "property_media" ADD COLUMN "activeGenerationId" TEXT, ADD COLUMN "watermarkRevision" INTEGER;
ALTER TABLE "companies" ADD COLUMN "watermarkSettings" JSONB, ADD COLUMN "watermarkRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "logoKey" TEXT;

CREATE TABLE "media_generations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "userId" TEXT,
    "parentId" TEXT,
    "operation" "AiOperation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "prompt" TEXT,
    "options" JSONB,
    "inputKey" TEXT NOT NULL,
    "outputKey" TEXT,
    "thumbKey" TEXT,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "cost" DECIMAL(10,4),
    "durationMs" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_generations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "media_generations_mediaId_createdAt_idx" ON "media_generations"("mediaId", "createdAt");
CREATE INDEX "media_generations_companyId_createdAt_idx" ON "media_generations"("companyId", "createdAt");
ALTER TABLE "media_generations" ADD CONSTRAINT "media_generations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_generations" ADD CONSTRAINT "media_generations_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "property_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
