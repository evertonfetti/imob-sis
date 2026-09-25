# Plataforma Imobiliária

Monorepo (pnpm) — NestJS + Fastify + Prisma/PostgreSQL, admin em React/Vite e site em Next.js.
Roadmap e escopo: fundação → imóveis → fotos → site → CRM → WhatsApp → marketing → IA → comercial → SaaS.

**Status:** Blocos 1 a 6 concluídos — fundação (auth, RBAC, multiempresa, auditoria), imóveis/proprietários/catálogo, fotos, site público, CRM (funil, kanban, timeline, tarefas, distribuição) e WhatsApp (API oficial da Meta).

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

### CRM

- **Funil:** 11 etapas padrão (Novo → … → Fechado / Perdido). Renomeie e mude as cores em *Pipeline → Configurar funil*. Mover para "Perdido" exige o motivo.
- **Distribuição de leads** (*Empresa e filiais*): **Manual** ou **Rodízio** entre corretores. O corretor responsável por um imóvel recebe os leads dele quando é um corretor; caso contrário vale a distribuição configurada.
- **Quem vê o quê:** só quem tem a permissão `lead.view_all` (administrador, gerente, atendimento, marketing) vê os leads de todos; o corretor vê os que estão atribuídos a ele.
- Todo lead novo com responsável ganha a tarefa *"Fazer o primeiro contato"* (prazo de 30 min). Cada movimento gera histórico (tempo por etapa) e registro na timeline.

### WhatsApp (API oficial da Meta)

Conecte em **Integrações → WhatsApp** (ID do número, token permanente e segredo do app). A tela mostra a **URL do webhook**
(`https://SUA-API/webhooks/meta/whatsapp`) e o **token de verificação** para colar na Meta (WhatsApp → Configuração → Webhook, campo `messages`).
Os segredos ficam criptografados no banco (AES-256-GCM) e nunca voltam pela API.

- **Recebimento:** toda mensagem valida a assinatura `X-Hub-Signature-256`. O cliente é reconhecido pelo telefone; se não houver lead aberto, um lead novo (origem WhatsApp) entra no funil, com o imóvel identificado pelo código (ex.: `IM0012`) e a campanha do clique no site.
- **Envio:** dentro de 24 h da última mensagem do cliente vale texto livre; depois disso, só **modelos aprovados** na Meta. Falhas ficam visíveis e podem ser reenviadas.
- Cada empresa usa o seu número: o webhook é roteado pelo `phone_number_id`.

### Fotos e mídias

- **Padrão (sem configurar nada):** as fotos ficam no volume `uploads` do Docker e são servidas pela própria API. **Faça backup desse volume.**
- **S3 / Cloudflare R2 / MinIO (recomendado para escalar):** defina `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` e `S3_PUBLIC_URL` (URL pública/CDN do bucket). Nesse modo o navegador envia direto ao bucket, então configure o **CORS do bucket** para permitir `PUT` e o header `Content-Type` a partir de `ADMIN_URL`.
- Cada foto gera uma versão otimizada (WebP, até 2400 px) e uma miniatura; **o original é sempre preservado**. O processamento roda em fila (Redis + BullMQ) com 3 tentativas.

As **migrations rodam automaticamente a cada deploy**: ao subir, a `api` executa `prisma migrate deploy` e a
sincronização idempotente de papéis/permissões. Se a migration falhar, o container não inicia (veja os logs da `api`).
Health check: `/api/v1/health`.

Depois do primeiro acesso, troque a senha do administrador e remova `SEED_ADMIN_PASSWORD` do ambiente.

> Desenvolvimento local: `docker compose -f docker-compose.dev.yml up -d` (PostgreSQL, Redis e MinIO).
