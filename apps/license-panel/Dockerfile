# Contexto de build: raiz do repositório (Build Path "/", Dockerfile "apps/license-panel/Dockerfile")
# Infraestrutura só sua: nunca vai para a VPS do cliente (veja docker-compose.license.yml).
FROM node:22-slim AS build
# Baixa o pnpm agora, antes de copiar o código: fica em cache e não depende da rede a cada deploy
# (só refaz se o Dockerfile mudar). Mantenha a versão igual ao "packageManager" do package.json.
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
WORKDIR /app
COPY . .
ARG VITE_API_URL=/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @imob/types build \
 && pnpm --filter @imob/license-panel build

FROM nginx:1.27-alpine
COPY apps/license-panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/license-panel/dist /usr/share/nginx/html
EXPOSE 80
