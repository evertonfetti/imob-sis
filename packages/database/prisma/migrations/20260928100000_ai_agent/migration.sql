-- Modelos de IA com finalidade (imagem ou texto) e custo por tokens.
CREATE TYPE "AiModelKind" AS ENUM ('IMAGE', 'TEXT');
ALTER TABLE "ai_models" ADD COLUMN "kind" "AiModelKind" NOT NULL DEFAULT 'IMAGE', ADD COLUMN "inputCostPerMTok" DECIMAL(10,4), ADD COLUMN "outputCostPerMTok" DECIMAL(10,4);

-- Agente de atendimento: quem atende a conversa (robô ou pessoa) e marcação das mensagens do robô.
CREATE TYPE "ConversationHandler" AS ENUM ('BOT', 'HUMAN');
ALTER TABLE "conversations" ADD COLUMN "handler" "ConversationHandler" NOT NULL DEFAULT 'BOT', ADD COLUMN "handlerChangedAt" TIMESTAMP(3), ADD COLUMN "handoffReason" TEXT, ADD COLUMN "botReplies" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "botLockUntil" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN "sentByBot" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "agentSettings" JSONB;

-- Base de conhecimento (documentos → trechos com busca por texto completo em português).
CREATE TYPE "AiDocumentStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');
CREATE TABLE "ai_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "AiDocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_documents_companyId_createdAt_idx" ON "ai_documents"("companyId", "createdAt");
ALTER TABLE "ai_documents" ADD CONSTRAINT "ai_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', "content")) STORED,
    CONSTRAINT "ai_document_chunks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_document_chunks_documentId_position_idx" ON "ai_document_chunks"("documentId", "position");
CREATE INDEX "ai_document_chunks_companyId_idx" ON "ai_document_chunks"("companyId");
CREATE INDEX "ai_document_chunks_tsv_idx" ON "ai_document_chunks" USING GIN ("tsv");
ALTER TABLE "ai_document_chunks" ADD CONSTRAINT "ai_document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ai_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Registro de cada chamada do agente (auditoria e consumo).
CREATE TABLE "ai_agent_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT,
    "leadId" TEXT,
    "modelId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "actions" JSONB,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_agent_runs_companyId_createdAt_idx" ON "ai_agent_runs"("companyId", "createdAt");
CREATE INDEX "ai_agent_runs_conversationId_createdAt_idx" ON "ai_agent_runs"("conversationId", "createdAt");
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
