#!/bin/sh
set -e

echo "[deploy] aplicando migrations..."
(cd /app/packages/license-database && ./node_modules/.bin/prisma migrate deploy)

echo "[deploy] garantindo o primeiro funcionário..."
node /app/packages/license-database/dist/bootstrap-cli.js

echo "[deploy] iniciando servidor de licenças..."
exec node /app/apps/license-api/dist/main.js
