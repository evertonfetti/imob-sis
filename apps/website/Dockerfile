# Contexto de build: raiz do repositório (Easypanel: Build Path "/", Dockerfile "apps/website/Dockerfile")
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @imob/website build

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/website/.next/standalone ./
COPY --from=build /app/apps/website/.next/static ./apps/website/.next/static
EXPOSE 3000
CMD ["node", "apps/website/server.js"]
