import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHmac } from 'node:crypto';
import dns from 'node:dns/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auth, bootApp, login, makeImage, resetAndSeed } from './helpers';

const SOCIAL_ENV = { META_APP_ID: '1234567890', META_APP_SECRET: 'app-secret-social-1234567890', API_PUBLIC_URL: 'https://api.teste.com.br', SOCIAL_WEBHOOK_VERIFY_TOKEN: 'verify-token-do-servidor' };
const PSID = 'psid-cliente-001';
const IGSID = 'igsid-cliente-001';
const KEY = 'sk-agent-inbox-test-1234567890';

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
let companyId: string;
let fbAccountId = '';
let igAccountId = '';
let seq = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dnsLookup: any;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });

// ---------- Meta e IA simuladas ----------
const sent: { to: string; text?: string; attachmentUrl?: string }[] = [];
let png: Buffer;
const PAGES = [{ id: 'PAGE1', name: 'Atelier Imóveis', access_token: 'PAGE-TOKEN-1', instagram_business_account: { id: 'IG1', username: 'atelierimoveis' } }];
let sendFail: { code: number; status?: number } | null = null;
let llm: () => { reply: string; actions: unknown[] } = () => ({ reply: 'Olá! Como posso ajudar?', actions: [] });

const fetchStub = vi.fn(async (input: any, init: any = {}) => {
  const url = String(input);
  const u = new URL(url);
  const path = u.pathname.replace(/^\/v\d+\.\d+\//, '');
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  const body = init.body ? JSON.parse(init.body) : null;

  if (path === 'oauth/access_token') return json({ access_token: u.searchParams.get('grant_type') === 'fb_exchange_token' ? 'LONG-USER-TOKEN' : 'SHORT-USER-TOKEN' });
  if (path === 'me/accounts') return json({ data: PAGES });
  if (/^PAGE\d\/subscribed_apps$/.test(path)) return json({ success: true });
  if (path === 'me/messages' && (init.method ?? 'GET') === 'POST') {
    if (sendFail) return json({ error: { message: 'Falha simulada', code: sendFail.code } }, sendFail.status ?? 400);
    sent.push({ to: body.recipient.id, text: body.message?.text, attachmentUrl: body.message?.attachment?.payload?.url });
    return json({ message_id: `mid.OUT${++seq}`, recipient_id: body.recipient.id });
  }
  if (url.startsWith('https://scontent.xx.fbcdn.net/')) return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/jpeg' } }); // anexo simulado da Meta
  if (/api\.openai\.com\/v1\/models/.test(url)) return json({ data: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-image-1'].map((id) => ({ id })) });
  if (/api\.openai\.com\/v1\/chat\/completions/.test(url)) return json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(llm()) } }], usage: { prompt_tokens: 500, completion_tokens: 50 } });
  return json({ error: { message: `sem rota simulada: ${path}` } }, 500);
});

async function connectAndActivate(who = 'admin') {
  const { url } = (await call('POST', '/social/connect', who, {})).json() as { url: string };
  const u = new URL(url);
  await call('GET', `/social/oauth/callback?code=CODE123&state=${encodeURIComponent(u.searchParams.get('state')!)}`, who);
  const pending = (await call('GET', '/social/accounts', who)).json().pending as { id: string; provider: string }[];
  await call('POST', '/social/accounts/activate', who, { accountIds: pending.map((p) => p.id) });
  const { accounts } = (await call('GET', '/social/accounts', who)).json();
  fbAccountId = accounts.find((a: { provider: string }) => a.provider === 'FACEBOOK_PAGE').id;
  igAccountId = accounts.find((a: { provider: string }) => a.provider === 'INSTAGRAM').id;
}

const sign = (raw: string) => `sha256=${createHmac('sha256', SOCIAL_ENV.META_APP_SECRET).update(raw).digest('hex')}`;
const webhook = (url: string, body: object, signed = true) => {
  const raw = JSON.stringify(body);
  return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...(signed ? { 'x-hub-signature-256': sign(raw) } : {}) }, payload: raw });
};
const fbEnvelope = (messaging: object[]) => ({ object: 'page', entry: [{ id: 'PAGE1', messaging }] });
const igEnvelope = (messaging: object[]) => ({ object: 'instagram', entry: [{ id: 'IG1', messaging }] });
const textMsg = (sender: string, text: string, mid = `mid.IN${++seq}`) => ({ sender: { id: sender }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: { mid, text } });

const convOf = async (channel: 'FACEBOOK' | 'INSTAGRAM', externalId: string) => prisma.conversation.findUniqueOrThrow({ where: { companyId_channel_externalId: { companyId, channel, externalId } } });

beforeAll(async () => {
  png = await makeImage(64, 64, 'jpeg');
  vi.stubGlobal('fetch', fetchStub);
  // A validação de SSRF confere o DNS do host do anexo; aqui simulamos a resolução sem depender de rede real.
  dnsLookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '157.240.1.1', family: 4 }] as never);
  await resetAndSeed();
  app = await bootApp(SOCIAL_ENV);
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  companyId = (await prisma.user.findFirstOrThrow({ where: { email: 'admin.a@teste.com' } })).companyId;
  await connectAndActivate('admin');
});
afterEach(() => { sendFail = null; sent.length = 0; llm = () => ({ reply: 'Olá! Como posso ajudar?', actions: [] }); });
afterAll(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await app.close(); await prisma.$disconnect(); });

describe('webhook: verificação', () => {
  it('aceita o token de verificação do app do servidor e recusa qualquer outro', async () => {
    const ok = await app.inject({ method: 'GET', url: `/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=${SOCIAL_ENV.SOCIAL_WEBHOOK_VERIFY_TOKEN}&hub.challenge=123` });
    expect(ok.statusCode).toBe(200); expect(ok.body).toBe('123');
    const bad = await app.inject({ method: 'GET', url: '/webhooks/meta/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123' });
    expect(bad.statusCode).toBe(403);
  });
});

describe('Messenger: recebimento', () => {
  it('cria cliente, lead e conversa na primeira mensagem; reaproveita na segunda; ignora assinatura inválida e eco do próprio envio', async () => {
    expect((await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg(PSID, 'Olá, vi o apartamento')]), false)).statusCode).toBe(401);

    const r = await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg(PSID, 'Olá, vi o apartamento')]));
    expect(r.statusCode).toBe(200);
    const conv = await convOf('FACEBOOK', PSID);
    expect(conv.status).toBe('OPEN'); expect(conv.handler).toBe('BOT'); expect(conv.socialAccountId).toBe(fbAccountId);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: conv.leadId! } });
    expect(lead.source).toBe('FACEBOOK');

    // eco do próprio envio (is_echo) é ignorado, não gera mensagem nem erro
    const echo = await webhook('/webhooks/meta/messenger', fbEnvelope([{ sender: { id: 'PAGE1' }, recipient: { id: PSID }, timestamp: Date.now(), message: { mid: 'mid.ECHO', is_echo: true, text: 'oi' } }]));
    expect(echo.statusCode).toBe(200);

    await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg(PSID, 'Quanto custa?')]));
    const thread = (await call('GET', `/conversations/${conv.id}`, 'admin')).json();
    expect(thread.channel).toBe('FACEBOOK');
    expect(thread.messages.filter((m: { direction: string }) => m.direction === 'INBOUND')).toHaveLength(2);
    expect(await prisma.lead.count({ where: { companyId, source: 'FACEBOOK' } })).toBe(1); // segunda mensagem reaproveitou o lead
  });

  it('baixa e guarda o anexo da Meta (a URL dela expira)', async () => {
    const r = await webhook('/webhooks/meta/messenger', fbEnvelope([{ sender: { id: 'psid-foto' }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: { mid: `mid.IMG${++seq}`, attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/foto.jpg' } }] } }]));
    expect(r.statusCode).toBe(200);
    const conv = await convOf('FACEBOOK', 'psid-foto');
    const thread = (await call('GET', `/conversations/${conv.id}`, 'admin')).json();
    const msg = thread.messages[0];
    expect(msg.hasMedia).toBe(true);
    const media = (await call('GET', `/messages/${msg.id}/media`, 'admin')).json();
    expect(media.mime).toBe('image/jpeg');
  });

  it('nunca busca a URL de um anexo fora dos domínios da Meta, nem uma que resolva para rede interna (SSRF)', async () => {
    // Host fora da lista permitida: nem chega a dar fetch.
    const r1 = await webhook('/webhooks/meta/messenger', fbEnvelope([{ sender: { id: 'psid-ssrf-1' }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: { mid: `mid.SSRF1-${++seq}`, attachments: [{ type: 'image', payload: { url: 'http://169.254.169.254/latest/meta-data/' } }] } }]));
    expect(r1.statusCode).toBe(200);
    expect((await convOf('FACEBOOK', 'psid-ssrf-1')).id).toBeTruthy();
    const msg1 = (await call('GET', `/conversations/${(await convOf('FACEBOOK', 'psid-ssrf-1')).id}`, 'admin')).json().messages[0];
    expect(msg1.hasMedia).toBe(false); // a mensagem é salva; só o anexo (perigoso) é descartado
    expect(fetchStub).not.toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data/', expect.anything());

    // Host na lista permitida, mas o DNS resolve para um IP privado: também recusa.
    dnsLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never);
    const r2 = await webhook('/webhooks/meta/messenger', fbEnvelope([{ sender: { id: 'psid-ssrf-2' }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: { mid: `mid.SSRF2-${++seq}`, attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/interna.jpg' } }] } }]));
    expect(r2.statusCode).toBe(200);
    const msg2 = (await call('GET', `/conversations/${(await convOf('FACEBOOK', 'psid-ssrf-2')).id}`, 'admin')).json().messages[0];
    expect(msg2.hasMedia).toBe(false);
  });

  it('não duplica ao reenviar a mesma mensagem (idempotência pelo mid)', async () => {
    const payload = fbEnvelope([textMsg('psid-dup', 'Mensagem única', 'mid.DUP1')]);
    await webhook('/webhooks/meta/messenger', payload);
    await webhook('/webhooks/meta/messenger', payload);
    const conv = await convOf('FACEBOOK', 'psid-dup');
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
  });
});

describe('Instagram: recebimento', () => {
  it('usa o canal INSTAGRAM, a conta do Instagram conectada, e um lead separado do Messenger', async () => {
    const r = await webhook('/webhooks/meta/instagram', igEnvelope([{ sender: { id: IGSID }, recipient: { id: 'IG1' }, timestamp: Date.now(), message: { mid: `mid.IG${++seq}`, text: 'Oi, vi no Instagram' } }]));
    expect(r.statusCode).toBe(200);
    const conv = await convOf('INSTAGRAM', IGSID);
    expect(conv.socialAccountId).toBe(igAccountId);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: conv.leadId! } });
    expect(lead.source).toBe('INSTAGRAM');
  });
});

describe('envio manual (painel)', () => {
  it('envia pelo Messenger e marca como enviada; fora da janela de 24h recusa texto; nunca aceita modelo', async () => {
    await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg('psid-envio', 'Oi')]));
    const conv = await convOf('FACEBOOK', 'psid-envio');
    const r = await call('POST', `/conversations/${conv.id}/messages`, 'admin', { text: 'Olá! Em que posso ajudar?' });
    expect(r.statusCode).toBe(201);
    expect(sent).toMatchObject([{ to: 'psid-envio', text: 'Olá! Em que posso ajudar?' }]);

    expect((await call('POST', `/conversations/${conv.id}/messages`, 'admin', { template: { name: 'x' } })).json().code).toBe('SOCIAL_INBOX_TEMPLATE_UNSUPPORTED');

    await prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await call('POST', `/conversations/${conv.id}/messages`, 'admin', { text: 'Ainda aí?' })).json().code).toBe('SOCIAL_INBOX_WINDOW_CLOSED');
  });

  it('token inválido/expirado: marca a conta como expirada e devolve erro', async () => {
    await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg('psid-expira', 'Oi')]));
    const conv = await convOf('FACEBOOK', 'psid-expira');
    sendFail = { code: 190, status: 401 };
    const r = await call('POST', `/conversations/${conv.id}/messages`, 'admin', { text: 'Oi' });
    expect(r.json().code).toBe('SOCIAL_INBOX_SEND_FAILED');
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: fbAccountId } })).status).toBe('EXPIRED');
    await prisma.socialAccount.update({ where: { id: fbAccountId }, data: { status: 'ACTIVE' } }); // não deixa os testes seguintes com a conta "quebrada"
  });
});

describe('isolamento entre empresas', () => {
  it('a empresa B não vê conversas nem mensagens da empresa A', async () => {
    await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg('psid-isolado', 'Oi')]));
    const conv = await convOf('FACEBOOK', 'psid-isolado');
    expect((await call('GET', `/conversations/${conv.id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('GET', '/conversations?pageSize=100', 'adminB')).json().items.some((c: { id: string }) => c.id === conv.id)).toBe(false);
  });
});

describe('agente de IA responde pelo Messenger', () => {
  it('liga o agente, recebe uma mensagem e ele responde automaticamente pela Send API', async () => {
    const found = (await call('POST', '/ai/discover', 'admin', { provider: 'openai', apiKey: KEY })).json() as { model: string; label: string; guess: string; tier: string }[];
    const models = found.filter((m) => m.guess === 'TEXT').map((m) => ({ label: m.label, model: m.model, kind: 'TEXT', tier: m.tier, costUsd: 0, inputCostPerMTok: 0.15, outputCostPerMTok: 0.6 }));
    const acc = (await call('POST', '/ai/accounts', 'admin', { name: 'OpenAI textos', provider: 'openai', apiKey: KEY, models })).json().accounts[0];
    const modelId = acc.models.find((m: { model: string }) => m.model === 'gpt-5.4-mini').id;
    const upd = await call('PUT', '/agent/settings', 'admin', { enabled: true, modelId });
    expect(upd.json().settings.enabled).toBe(true);

    llm = () => ({ reply: 'Olá! Temos sim opções disponíveis.', actions: [] });
    // Em NODE_ENV=test o agente roda de forma síncrona (sem espera/timer) — a resposta já saiu quando o webhook retorna.
    await webhook('/webhooks/meta/messenger', fbEnvelope([textMsg('psid-agente', 'Tem apartamento disponível?')]));
    expect(sent.some((s) => s.to === 'psid-agente' && s.text === 'Olá! Temos sim opções disponíveis.')).toBe(true);
    const conv = await convOf('FACEBOOK', 'psid-agente');
    expect(conv.handler).toBe('BOT');
  });
});
