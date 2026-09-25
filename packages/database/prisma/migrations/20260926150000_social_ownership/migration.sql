-- Apps e contas sociais passam a ter dono; ficam privados a menos que o dono compartilhe.
ALTER TABLE "social_apps" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "social_accounts" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
-- O que já existia continua acessível a toda a equipe (compatibilidade).
UPDATE "social_apps" SET "shared" = true;
UPDATE "social_accounts" SET "shared" = true WHERE "status" <> 'PENDING';
-- O mesmo perfil pode ser conectado por usuários diferentes, cada um com o seu token.
DROP INDEX "social_accounts_companyId_provider_externalId_key";
CREATE UNIQUE INDEX "social_accounts_companyId_connectedById_provider_externalId_key" ON "social_accounts"("companyId", "connectedById", "provider", "externalId");
-- Cada usuário tem os próprios apps (o mesmo ID de app pode existir para donos diferentes).
DROP INDEX "social_apps_companyId_appId_key";
CREATE UNIQUE INDEX "social_apps_companyId_createdById_appId_key" ON "social_apps"("companyId", "createdById", "appId");
