-- Várias contas de IA por empresa, cada uma com seus modelos (econômico/padrão/premium).
CREATE TYPE "AiTier" AS ENUM ('ECONOMIC', 'STANDARD', 'PREMIUM');

CREATE TABLE "ai_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secrets" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_accounts_companyId_idx" ON "ai_accounts"("companyId");
ALTER TABLE "ai_accounts" ADD CONSTRAINT "ai_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tier" "AiTier" NOT NULL DEFAULT 'STANDARD',
    "costUsd" DECIMAL(10,4) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_models_accountId_model_key" ON "ai_models"("accountId", "model");
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ai_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "companies" ADD COLUMN "aiSettings" JSONB;
ALTER TABLE "media_generations" ADD COLUMN "accountId" TEXT, ADD COLUMN "modelId" TEXT;

-- A configuração anterior (um provedor por empresa) é descartada: as chaves ficam em contas cadastradas no painel.
DELETE FROM "integrations" WHERE "provider" = 'AI_IMAGE';
