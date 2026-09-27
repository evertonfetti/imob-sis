# Contexto de build: raiz do repositório (Build Path "/", Dockerfile "apps/license-api/Dockerfile")
# Infraestrutura só sua: nunca vai para a VPS do cliente (veja docker-compose.license.yml).
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Baixa o pnpm agora, antes de copiar o código: fica em cache e não depende da rede a cada deploy
# (só refaz se o Dockerfile mudar). Mantenha a versão igual ao "packageManager" do package.json.
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY . .
# `prisma generate` só precisa de uma URL de formato válido, não conecta ao banco.
ENV LICENSE_DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @imob/types build \
 && pnpm --filter @imob/license-database build \
 && pnpm --filter @imob/license-api build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3433
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:'+(process.env.LICENSE_API_PORT||3433)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "/app/apps/license-api/docker-entrypoint.sh"]
