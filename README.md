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

`docker-compose.yml` sobe PostgreSQL, Redis e MinIO para desenvolvimento.

Verificações: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Deploy no Easypanel

Crie um projeto com **PostgreSQL** (serviço nativo do Easypanel) e três serviços de **App** apontando para este repositório.
Em todos: *Source → GitHub*, **Build → Dockerfile**, **Build Path `/`** (raiz do repo).

### 1. `api` — Dockerfile: `apps/api/Dockerfile` — porta `3333`

As **migrations rodam automaticamente a cada deploy** (`prisma migrate deploy`), seguidas da sincronização
idempotente de papéis/permissões, antes de a API subir. Se a migration falhar, o container não inicia.

Variáveis de ambiente:

| Variável | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URL interna do PostgreSQL do Easypanel |
| `JWT_ACCESS_SECRET` | segredo aleatório com 32+ caracteres (`openssl rand -base64 48`) |
| `ADMIN_URL` | URL pública do admin (CORS e links de e-mail), ex.: `https://painel.seudominio.com.br` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | primeiro administrador (criado só se o e-mail não existir) |
| `SEED_COMPANY_NAME` | nome da imobiliária (opcional, só na primeira execução) |
| `S3_*` | credenciais do storage S3-compatible (a partir do Bloco 3) |

Domínio sugerido: `api.seudominio.com.br`. Health check: `/api/v1/health`.

### 2. `admin` — Dockerfile: `apps/admin/Dockerfile` — porta `80`

*Build argument* (obrigatório): `VITE_API_URL=https://api.seudominio.com.br/api/v1`

### 3. `website` — Dockerfile: `apps/website/Dockerfile` — porta `3000`

Depois do primeiro acesso, troque a senha do administrador e remova `SEED_ADMIN_PASSWORD` do serviço.
