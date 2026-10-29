-- Agente de IA e "Conversas" passam a atender também o inbox do Messenger (Facebook) e do Instagram Direct,
-- além do WhatsApp. As tabelas de conversa/mensagem já eram genéricas; só faltavam estes dois canais.

ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'FACEBOOK';
ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'INSTAGRAM';

-- Qual Página/perfil conectado recebeu a mensagem (null no WhatsApp, que tem um único número por empresa).
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "socialAccountId" TEXT;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_socialAccountId_fkey"
  FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "conversations_socialAccountId_idx" ON "conversations"("socialAccountId");

-- Token que a Meta exige para validar o endpoint do webhook (gerado por nós, colado no painel de
-- desenvolvedores da Meta). Nulo nos apps cadastrados antes deste recurso; gerado sob demanda.
ALTER TABLE "social_apps" ADD COLUMN IF NOT EXISTS "webhookVerifyToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "social_apps_webhookVerifyToken_key" ON "social_apps"("webhookVerifyToken");
