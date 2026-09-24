# Contexto de build: raiz do repositório (Easypanel: Build Path "/", Dockerfile "apps/admin/Dockerfile")
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# URL pública da API, embutida no build. Ex.: https://api.seudominio.com.br/api/v1
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @imob/types build \
 && pnpm --filter @imob/admin build

FROM nginx:1.27-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
