-- Versão intermediária (1600px) das fotos: é a servida nas páginas do site.
-- Fotos já enviadas ficam com NULL e continuam sendo servidas na versão 2400px
-- até serem reprocessadas em Empresa → Imagens.
ALTER TABLE "property_media" ADD COLUMN IF NOT EXISTS "mediumKey" TEXT;
