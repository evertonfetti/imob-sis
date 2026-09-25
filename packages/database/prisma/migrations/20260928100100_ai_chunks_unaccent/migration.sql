-- Busca sem acento: o índice de texto completo ignora acentos (translate é nativo e imutável, sem extensões).
DROP INDEX IF EXISTS "ai_document_chunks_tsv_idx";
ALTER TABLE "ai_document_chunks" DROP COLUMN "tsv";
ALTER TABLE "ai_document_chunks" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (
  to_tsvector('portuguese', translate("content", 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
) STORED;
CREATE INDEX "ai_document_chunks_tsv_idx" ON "ai_document_chunks" USING GIN ("tsv");
