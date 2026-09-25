-- Lead score por regras: data do último cálculo e índice para ordenar/filtrar por score.
ALTER TABLE "leads" ADD COLUMN "scoreUpdatedAt" TIMESTAMP(3);
CREATE INDEX "leads_companyId_score_idx" ON "leads"("companyId", "score");
