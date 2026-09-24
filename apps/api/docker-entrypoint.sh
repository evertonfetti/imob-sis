#!/bin/sh
set -e

echo "[deploy] aplicando migrations..."
(cd /app/packages/database && ./node_modules/.bin/prisma migrate deploy)

echo "[deploy] sincronizando papéis e permissões..."
node /app/packages/database/dist/bootstrap-cli.js

echo "[deploy] iniciando API..."
exec node /app/apps/api/dist/main.js
