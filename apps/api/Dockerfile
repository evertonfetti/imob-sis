# Contexto de build: raiz do repositório (Easypanel: Build Path "/", Dockerfile "apps/api/Dockerfile")
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
# `prisma generate` só precisa de uma URL de formato válido, não conecta ao banco.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm install --frozen-lockfile \
 && pnpm build:packages \
 && pnpm --filter @imob/api build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data/uploads
VOLUME /data/uploads
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:'+(process.env.API_PORT||3333)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "/app/apps/api/docker-entrypoint.sh"]
