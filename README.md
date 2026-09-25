# Plataforma Imobiliária

Monorepo (pnpm) — NestJS + Fastify + Prisma/PostgreSQL, admin em React/Vite e site em Next.js.
Roadmap e escopo: fundação → imóveis → fotos → site → CRM → WhatsApp → marketing → IA → comercial → SaaS.

**Status:** Blocos 1 a 10 concluídos — fundação (auth, RBAC, multiempresa, auditoria), imóveis/proprietários/catálogo, fotos, site público, CRM, WhatsApp (API oficial da Meta) e marketing (campanhas, Pixel e Conversions API) publicação/agendamento no Instagram e Facebook comercial (visitas, agenda e propostas) e inteligência (score, matching, relatórios e alertas).

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

### Marketing (campanhas, Pixel e Conversions API)

- **Relatórios** (*Marketing*): leads por dia, por canal, por fonte de anúncio e **por campanha** (`utm_campaign`): quantos leads, quantos foram qualificados, quantos fecharam, valor fechado e cliques no WhatsApp. Origens são comparadas sem diferenciar maiúsculas.
- **Conexão com a Meta** (*Integrações → Meta Pixel e Conversions API*): ID do Pixel, token da CAPI e, se quiser, o código de teste. O token fica criptografado.
- **Eventos enviados à Meta:** `Lead` (formulário do site), `Contact` (clique no WhatsApp) e, por etapa do funil, `QualifiedLead`, `Schedule` e `Purchase` (com o valor do imóvel). O mapeamento etapa → evento é editável em *Marketing → Conversões*. Cada evento é enviado uma vez por lead, sem bloquear o CRM: vai para uma fila com até 3 tentativas; falhas ficam visíveis e podem ser reenviadas.
- **Privacidade (LGPD):** e-mail, telefone e nome vão sempre com hash (SHA-256), e **somente de visitantes que aceitaram** o aviso de cookies do site. O Pixel só é carregado após o aceite. Sem consentimento, o evento é registrado como *Ignorado* e nenhum dado pessoal é guardado nele.
- **Sem duplicidade:** o navegador (Pixel) e o servidor (CAPI) usam o mesmo `event_id`, e a Meta conta uma vez.
- O site guarda o ID do Pixel em cache por até 1 minuto: depois de conectar, o aviso de cookies e o Pixel aparecem em até 1 minuto.

### Publicação no Instagram e no Facebook

No imóvel, **Publicar nas redes** abre a postagem já pronta (fotos com a capa primeiro, contas conectadas e o texto com a descrição do imóvel, preço, local, link do site e código); falta só a data (ou publicar agora). Também em *Redes sociais → Nova publicação*.

- **Conectar:** *Redes sociais → Contas conectadas → Entrar com o Facebook*. O sistema lista as Páginas e as contas do Instagram profissional ligadas a elas, e você escolhe quais usar. Cada empresa cadastra **um ou mais apps da Meta** na mesma tela (nome + ID + chave secreta, validados na Meta e guardados criptografados no banco), sem tocar no servidor, e escolhe por qual app entrar ao conectar contas; a tela mostra o passo a passo e a URI de redirecionamento a cadastrar. `META_APP_ID`/`META_APP_SECRET` são só um padrão opcional para empresas que não cadastraram o seu. Em modo de desenvolvimento só quem tem função no app consegue entrar; para liberar a todos é preciso enviar o app para a **revisão da Meta**.
- **Agendamento próprio:** o banco é a fonte da verdade (sobrevive a reinícios; não precisa de Redis) e há trava contra publicação duplicada com várias instâncias. Cada rede publica e falha separadamente, com até 3 tentativas para erros temporários e botão **Reenviar**.
- **Instagram:** aceita só JPEG e proporção entre 4:5 e 1,91:1. O sistema gera sozinho uma versão JPEG recortada de cada foto (o original é preservado). Carrossel de até 10 fotos; texto de até 2.200 caracteres. As fotos precisam estar acessíveis publicamente (`API_PUBLIC_URL`).
- Os tokens das Páginas ficam criptografados. Se a Meta invalidar um token, a conta aparece como *Expirada* e pede para reconectar.

### Comercial (visitas, agenda e propostas)

- **Visitas:** agendadas pelo lead (ou em *Agenda*), com corretor, duração e observações. O sistema avisa **conflito de horário** do corretor (dá para agendar mesmo assim). Ciclo: agendada → confirmada → realizada / cancelada / cliente não compareceu; "realizada" e "faltou" só valem a partir do horário. Reagendar cancela e recria o lembrete de confirmação.
- **Propostas:** valor pedido (do imóvel) x proposta, entrada, financiamento, validade e condições, com **histórico de contrapropostas** (comprador e proprietário). Aceitar/recusar/fechar exige a permissão *Gerenciar propostas*. Propostas em aberto **expiram sozinhas** na data de validade.
- **Efeito no imóvel e no funil:** proposta aceita **reserva** o imóvel; *Fechar negócio* marca o imóvel como vendido/alugado, leva o lead a *Fechado* e cancela as outras propostas do imóvel. As etapas do funil só **avançam** (nunca retrocedem por automação) e usam papéis fixos, então continuam funcionando se forem renomeadas.
- **Automação:** timeline do lead, tarefas com prazo (confirmar visita 24h antes, ligar após a visita, reagendar quando o cliente falta) e o evento *Purchase* da Meta com o **valor negociado**.
- Corretores veem apenas as visitas/propostas dos próprios leads; quem tem *Ver todos os leads* vê tudo.

### Inteligência (score, matching, relatórios e alertas)

- **Score do lead (0–100, por regras, sem IA):** +10 orçamento informado, +10 respondeu no WhatsApp, +15 solicitou visita, +20 visita agendada, +25 visita realizada, +30 proposta. Frio < 30, morno < 60, quente ≥ 60. Atualiza sozinho a cada evento; ao esquentar, o corretor recebe uma tarefa (uma vez) e a timeline registra. Clique no selo do lead para ver o cálculo.
- **Matching:** *Imóveis compatíveis* no lead e *Leads compatíveis* no imóvel. Compara orçamento (aceita até +10% e considera a margem de negociação), cidade (outra cidade é descartada), bairro, dormitórios, tipo e características, e só conta o que o lead informou. Mostra o nível de compatibilidade e os motivos.
- **Automações:** ao publicar um imóvel, os leads com ≥ 75% de compatibilidade e responsável ganham a tarefa "Apresentar o imóvel"; lead parado há mais de 7 dias gera uma tarefa de retomada (uma por período parado); lead ganho/perdido encerra os follow-ups automáticos (tarefas manuais ficam).
- **Alertas** (*Precisa de atenção* no dashboard): lead sem atendimento, lead parado, tarefas atrasadas, visita sem confirmação ou sem resultado, proposta vencendo ou parada, cliente esperando resposta no WhatsApp. Cada usuário vê só o que é seu.
- **Relatórios:** período à escolha, conversão, tempo até fechar, volume negociado, leads por origem/dia, funil (quantos leads chegaram a cada etapa ou além), imóveis mais procurados, motivos de perda e desempenho da equipe (só para quem vê todos os leads).

### Fotos e mídias

- **Padrão (sem configurar nada):** as fotos ficam no volume `uploads` do Docker e são servidas pela própria API. **Faça backup desse volume.**
- **S3 / Cloudflare R2 / MinIO (recomendado para escalar):** defina `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` e `S3_PUBLIC_URL` (URL pública/CDN do bucket). Nesse modo o navegador envia direto ao bucket, então configure o **CORS do bucket** para permitir `PUT` e o header `Content-Type` a partir de `ADMIN_URL`.
- Cada foto gera uma versão otimizada (WebP, até 2400 px) e uma miniatura; **o original é sempre preservado**. O processamento roda em fila (Redis + BullMQ) com 3 tentativas.

As **migrations rodam automaticamente a cada deploy**: ao subir, a `api` executa `prisma migrate deploy` e a
sincronização idempotente de papéis/permissões. Se a migration falhar, o container não inicia (veja os logs da `api`).
Health check: `/api/v1/health`.

Depois do primeiro acesso, troque a senha do administrador e remova `SEED_ADMIN_PASSWORD` do ambiente.

> Desenvolvimento local: `docker compose -f docker-compose.dev.yml up -d` (PostgreSQL, Redis e MinIO).
