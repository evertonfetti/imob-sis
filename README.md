# Plataforma Imobiliária

Monorepo (pnpm) — NestJS + Fastify + Prisma/PostgreSQL, admin em React/Vite e site em Next.js.
Roadmap e escopo: fundação → imóveis → fotos → site → CRM → WhatsApp → marketing → IA → comercial → SaaS.

**Status:** Bloco 1 (Fundação) concluído — autenticação, RBAC, multiempresa, auditoria, erros padronizados, logs, base de storage.

```
apps/api        NestJS + Fastify (API /api/v1)
apps/admin      React + Vite (painel)
apps/website    Next.js (site público)
packages/database  Prisma (schema, migrations, seed/bootstrap)
packages/types     Permissões, schemas zod e códigos de erro compartilhados
```

## Desenvolvimento local

```bash
cp .env.example .env            # ajuste DATABASE_URL e o JWT_ACCESS_SECRET
pnpm install
pnpm build:packages
pnpm db:migrate                 # cria as tabelas
pnpm db:seed                    # empresa, papéis, permissões e primeiro admin (SEED_ADMIN_*)
pnpm dev:api                    # http://localhost:3333/api/v1
pnpm dev:admin                  # http://localhost:5173
```

`docker-compose.dev.yml` sobe PostgreSQL, Redis e MinIO para desenvolvimento.

Verificações: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Deploy no Easypanel (Docker Compose)

Um único serviço do tipo **Docker Compose**, apontando para este repositório (branch `main`).
O `docker-compose.yml` da raiz sobe tudo: **PostgreSQL + api + admin + website**.

### Variáveis (aba "Ambiente")

| Variável | Valor |
| --- | --- |
| `POSTGRES_PASSWORD` | senha do banco (gere uma forte) |
| `JWT_ACCESS_SECRET` | segredo aleatório com 32+ caracteres (`openssl rand -base64 48`) |
| `ADMIN_URL` | URL pública do painel, ex.: `https://painel.seudominio.com.br` (CORS e links de e-mail) |
| `VITE_API_URL` | URL pública da API, ex.: `https://api.seudominio.com.br/api/v1` (embutida no build do painel) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | primeiro administrador (criado só se o e-mail ainda não existir) |
| `SEED_COMPANY_NAME` | nome da imobiliária (opcional; só na primeira execução) |
| `S3_*` | storage S3-compatible (necessário a partir do Bloco 3) |

### Domínios (aba "Domínios")

| Serviço | Porta | Exemplo |
| --- | --- | --- |
| `api` | 3333 | `api.seudominio.com.br` |
| `admin` | 80 | `painel.seudominio.com.br` |
| `website` | 3000 | `www.seudominio.com.br` |

As **migrations rodam automaticamente a cada deploy**: ao subir, a `api` executa `prisma migrate deploy` e a
sincronização idempotente de papéis/permissões. Se a migration falhar, o container não inicia (veja os logs da `api`).
Health check: `/api/v1/health`.

Depois do primeiro acesso, troque a senha do administrador e remova `SEED_ADMIN_PASSWORD` do ambiente.

> Desenvolvimento local: `docker compose -f docker-compose.dev.yml up -d` (PostgreSQL, Redis e MinIO).
