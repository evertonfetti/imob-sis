-- CreateEnum
CREATE TYPE "MarketingEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'META_CAPI';

-- AlterTable
ALTER TABLE "lead_attributions" ADD COLUMN     "clientIp" TEXT,
ADD COLUMN     "clientUserAgent" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pageUrl" TEXT;

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "metaEvent" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_clicks" ADD COLUMN     "clientIp" TEXT,
ADD COLUMN     "clientUserAgent" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pageUrl" TEXT;

-- CreateTable
CREATE TABLE "marketing_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'META_CAPI',
    "eventName" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "MarketingEventStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "response" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "customerId" TEXT,

    CONSTRAINT "marketing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_events_companyId_createdAt_idx" ON "marketing_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "marketing_events_leadId_eventName_idx" ON "marketing_events"("leadId", "eventName");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_events_companyId_provider_eventId_key" ON "marketing_events"("companyId", "provider", "eventId");

-- AddForeignKey
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_events" ADD CONSTRAINT "marketing_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mapeamento padrão etapa → evento da Meta para os funis que já existem.
UPDATE "pipeline_stages" SET "metaEvent" = 'QualifiedLead' WHERE "qualifies" = true AND "metaEvent" IS NULL;
UPDATE "pipeline_stages" SET "metaEvent" = 'Schedule' WHERE "name" = 'Visita agendada' AND "metaEvent" IS NULL;
UPDATE "pipeline_stages" SET "metaEvent" = 'Purchase' WHERE "type" = 'WON' AND "metaEvent" IS NULL;
