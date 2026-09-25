-- Vários apps da Meta por empresa (antes: um só, guardado em integrations com provider META_APP).
CREATE TABLE "social_apps" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "secrets" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_apps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_apps_companyId_appId_key" ON "social_apps"("companyId", "appId");
ALTER TABLE "social_apps" ADD CONSTRAINT "social_apps_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "social_accounts" ADD COLUMN "socialAppId" TEXT;
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_socialAppId_fkey" FOREIGN KEY ("socialAppId") REFERENCES "social_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserva o app já cadastrado (o formato do segredo criptografado é o mesmo: { appSecret }).
INSERT INTO "social_apps" ("id", "companyId", "name", "appId", "secrets", "updatedAt")
SELECT gen_random_uuid()::text, "companyId", 'Aplicativo principal', "externalId", "secrets", CURRENT_TIMESTAMP
FROM "integrations" WHERE "provider" = 'META_APP' AND "externalId" IS NOT NULL AND "active" = true;
DELETE FROM "integrations" WHERE "provider" = 'META_APP';
