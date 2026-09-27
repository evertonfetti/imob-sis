# Contexto de build: raiz do repositório (compose: build.context "." e dockerfile "apps/website/Dockerfile")
FROM node:22-slim AS build
# Baixa o pnpm agora, antes de copiar o código: fica em cache e não depende da rede a cada deploy
# (só refaz se o Dockerfile mudar). Mantenha a versão igual ao "packageManager" do package.json.
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY . .
# URL pública da API, embutida no JavaScript do navegador (formulário e clique no WhatsApp).
ARG NEXT_PUBLIC_API_URL=http://localhost:3333/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @imob/types build \
 && pnpm --filter @imob/website build

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/website/.next/standalone ./
COPY --from=build /app/apps/website/.next/static ./apps/website/.next/static
EXPOSE 3000
# Em tempo de execução: SITE_URL (canonical/sitemap) e API_INTERNAL_URL (chamadas do servidor à API).
CMD ["node", "apps/website/server.js"]
