-- Qual versão de IA está de fato renderizada na foto publicada (para mostrar "aplicando…" enquanto a fila trabalha).
ALTER TABLE "property_media" ADD COLUMN "renderedGenerationId" TEXT;
