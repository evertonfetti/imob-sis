-- Vários Pixels da Meta por empresa, cada um com o seu token da Conversions API.

CREATE TABLE "meta_pixels" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "name" TEXT,
    "secrets" TEXT NOT NULL,
    "testEventCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meta_pixels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meta_pixels_companyId_pixelId_key" ON "meta_pixels"("companyId", "pixelId");
ALTER TABLE "meta_pixels" ADD CONSTRAINT "meta_pixels_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A conexão única de antes vira o primeiro Pixel (o token continua criptografado do mesmo jeito).
INSERT INTO "meta_pixels" ("id", "companyId", "pixelId", "name", "secrets", "testEventCode", "active", "createdAt", "updatedAt")
SELECT "id", "companyId", "externalId", NULLIF("config"->>'pixelName', ''), "secrets", NULLIF("config"->>'testEventCode', ''), "active", "createdAt", CURRENT_TIMESTAMP
FROM "integrations" WHERE "provider" = 'META_CAPI' AND "externalId" IS NOT NULL;

-- Histórico de eventos: passa a registrar para qual Pixel cada envio foi.
ALTER TABLE "marketing_events" ADD COLUMN "pixelId" TEXT NOT NULL DEFAULT '';
UPDATE "marketing_events" e SET "pixelId" = p."pixelId" FROM "meta_pixels" p WHERE p."companyId" = e."companyId" AND e."status" <> 'SKIPPED';
DROP INDEX "marketing_events_companyId_provider_eventId_key";
CREATE UNIQUE INDEX "marketing_events_companyId_provider_eventId_pixelId_key" ON "marketing_events"("companyId", "provider", "eventId", "pixelId");

DELETE FROM "integrations" WHERE "provider" = 'META_CAPI';

ALTER TABLE "lead_attributions" ADD COLUMN "visitorId" TEXT;
