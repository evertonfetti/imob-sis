# Plataforma Imobiliária

Monorepo (pnpm) — NestJS + Fastify + Prisma/PostgreSQL, admin em React/Vite e site em Next.js.
Roadmap e escopo: fundação → imóveis → fotos → site → CRM → WhatsApp → marketing → IA → comercial → SaaS.

**Status:** Blocos 1 a 4 concluídos — fundação (auth, RBAC, multiempresa, auditoria), imóveis/proprietários/catálogo, fotos (upload direto, fila, WebP, capa e ordenação) e site público (busca, SEO, formulário de interesse, WhatsApp).

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
| `SITE_URL` | URL pública do site, ex.: `https://www.seudominio.com.br` (canonical, sitemap e CORS do formulário) |
| `API_PUBLIC_URL` | URL pública da API **sem barra final e sem `/api/v1`**, ex.: `https://api.seudominio.com.br` (links das fotos e build do painel) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | primeiro administrador (criado só se o e-mail ainda não existir) |
| `SEED_COMPANY_NAME` | nome da imobiliária (opcional; só na primeira execução) |
| `S3_*` | opcional: storage S3-compatible (R2/S3/MinIO). Sem isso, as fotos ficam no volume `uploads` |

### Domínios (aba "Domínios")

| Serviço | Porta | Exemplo |
| --- | --- | --- |
| `api` | 3333 | `api.seudominio.com.br` |
| `admin` | 80 | `painel.seudominio.com.br` |
| `website` | 3000 | `www.seudominio.com.br` |

### Site público

O `website` lê os imóveis publicados pela API e faz cache de 1 a 5 minutos, então uma publicação leva até ~1 min para aparecer.
Cada formulário de interesse cria **cliente + lead + origem da campanha** (UTMs, `fbclid`, `gclid`, `fbc`/`fbp`) e aparece em **Leads** no painel;
cada clique no WhatsApp também é registrado. O número do WhatsApp e a cor da marca vêm de **Empresa** no painel. Sitemap em `/sitemap.xml`.

### Fotos e mídias

- **Padrão (sem configurar nada):** as fotos ficam no volume `uploads` do Docker e são servidas pela própria API. **Faça backup desse volume.**
- **S3 / Cloudflare R2 / MinIO (recomendado para escalar):** defina `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` e `S3_PUBLIC_URL` (URL pública/CDN do bucket). Nesse modo o navegador envia direto ao bucket, então configure o **CORS do bucket** para permitir `PUT` e o header `Content-Type` a partir de `ADMIN_URL`.
- Cada foto gera uma versão otimizada (WebP, até 2400 px) e uma miniatura; **o original é sempre preservado**. O processamento roda em fila (Redis + BullMQ) com 3 tentativas.

As **migrations rodam automaticamente a cada deploy**: ao subir, a `api` executa `prisma migrate deploy` e a
sincronização idempotente de papéis/permissões. Se a migration falhar, o container não inicia (veja os logs da `api`).
Health check: `/api/v1/health`.

Depois do primeiro acesso, troque a senha do administrador e remova `SEED_ADMIN_PASSWORD` do ambiente.

> Desenvolvimento local: `docker compose -f docker-compose.dev.yml up -d` (PostgreSQL, Redis e MinIO).
