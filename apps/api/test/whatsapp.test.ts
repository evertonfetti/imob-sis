import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auth, bootApp, login, makeImage, resetAndSeed, uploadPhoto } from './helpers';

const PHONE_A = '100200300';
const PHONE_B = '999888777';
const SECRET_A = 'segredo-do-app-A-1234567890';
const SECRET_B = 'segredo-do-app-B-0987654321';
const TOKEN = 'EAAGtokenDeTesteDaMeta1234567890';
const WA_ID = '5511977001122'; // cliente com DDI, como a Meta envia

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
const ids: Record<string, string> = {};
let typeId: string;
let seq = 0;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

// ---------- Meta simulada ----------
let graphFail: string | null = null;
let mediaFail = false;
const graphCalls: { url: string; method: string; body: any; auth: string | null }[] = [];
let png: Buffer;

const fetchStub = vi.fn(async (input: any, init: any = {}) => {
  const url = String(input);
  const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization ?? null };
  graphCalls.push(call);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://lookaside.fbsbx.com/')) return mediaFail ? new Response('nope', { status: 404 }) : new Response(new Uint8Array(png), { status: 200 });
  if (url.includes('/messages') && call.method === 'POST') {
    if (call.body?.status === 'read') return json({ success: true });
    if (graphFail) return json({ error: { message: graphFail, code: 131047 } }, 400);
    return json({ messages: [{ id: `wamid.OUT${++seq}` }] });
  }
  if (/\/v\d+\.\d+\/\d+\?fields=/.test(url)) return json({ display_phone_number: '+55 11 3000-1234', verified_name: 'Atelier Imóveis', quality_rating: 'GREEN' });
  if (/\/v\d+\.\d+\/MEDIA/.test(url)) return mediaFail ? json({ error: { message: 'Media expired' } }, 404) : json({ url: 'https://lookaside.fbsbx.com/file/1', mime_type: 'image/jpeg', file_size: png.length });
  return json({ error: { message: `sem rota simulada: ${url}` } }, 500);
});

// ---------- Ajudantes ----------
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });

const hook = (payload: object, secret: string | null = SECRET_A, headers: Record<string, string> = {}) => {
  const raw = JSON.stringify(payload);
  const sig = secret ? { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` } : {};
  return app.inject({ method: 'POST', url: '/webhooks/meta/whatsapp', headers: { 'content-type': 'application/json', ...sig, ...headers }, payload: raw });
};
const envelope = (phoneId: string, value: object) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '551130001234', phone_number_id: phoneId }, ...value } }] }],
});
const inbound = (text: string, over: Record<string, unknown> = {}, from = WA_ID, phoneId = PHONE_A, name = 'Cliente WA') =>
  envelope(phoneId, {
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id: over.id ?? `wamid.IN${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text }, ...over }],
  });
const statusHook = (wamid: string, status: string, extra: object = {}, phoneId = PHONE_A) =>
  envelope(phoneId, { statuses: [{ id: wamid, recipient_id: WA_ID, status, timestamp: String(Math.floor(Date.now() / 1000)), ...extra }] });

async function publishedProperty(title = 'Casa do WhatsApp') {
  const p = (await call('POST', '/properties', 'admin', { title, purpose: 'SALE', typeId, salePrice: 650000, city: 'Campinas', neighborhood: 'Cambuí', bedrooms: 3 })).json();
  await uploadPhoto(app, tk.admin!, p.id);
  await call('POST', `/properties/${p.id}/publish`, 'admin');
  return p;
}
const convOf = async (who = 'admin', waId = WA_ID) => (await call('GET', '/conversations?pageSize=100', who)).json().items.find((c: { phone: string }) => c.phone === waId);

beforeAll(async () => {
  png = await makeImage(64, 64, 'jpeg');
  vi.stubGlobal('fetch', fetchStub);
  await resetAndSeed();
  app = await bootApp();
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  ids.broker = (await call('GET', '/auth/me', 'broker')).json().id;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
});
afterEach(() => { graphFail = null; mediaFail = false; });
afterAll(async () => { vi.unstubAllGlobals(); await app.close(); await prisma.$disconnect(); });

describe('integração', () => {
  it('conecta, guarda segredos criptografados, nunca os devolve, valida com a Meta e respeita permissões', async () => {
    const before = (await call('GET', '/integrations/whatsapp', 'admin')).json();
    expect(before).toMatchObject({ connected: false, phoneNumberId: null, verifyToken: null });
    expect(before.webhookUrl).toMatch(/\/webhooks\/meta\/whatsapp$/);

    expect((await call('PUT', '/integrations/whatsapp', 'admin', { phoneNumberId: PHONE_A })).statusCode).toBe(400); // faltam token e segredo
    expect((await call('PUT', '/integrations/whatsapp', 'admin', { phoneNumberId: 'abc', accessToken: TOKEN, appSecret: SECRET_A })).statusCode).toBe(400);
    expect((await call('PUT', '/integrations/whatsapp', 'broker', { phoneNumberId: PHONE_A, accessToken: TOKEN, appSecret: SECRET_A })).statusCode).toBe(403);

    const saved = (await call('PUT', '/integrations/whatsapp', 'admin', { phoneNumberId: PHONE_A, accessToken: TOKEN, appSecret: SECRET_A })).json();
    expect(saved).toMatchObject({ connected: true, phoneNumberId: PHONE_A, accessTokenSet: true, appSecretSet: true });
    expect(saved.verifyToken).toMatch(/^[0-9a-f]{48}$/);
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    expect(JSON.stringify(saved)).not.toContain(SECRET_A);

    const row = await prisma.integration.findFirstOrThrow({ where: { externalId: PHONE_A } });
    expect(row.secrets).not.toContain(TOKEN); // criptografado em repouso
    expect(row.secrets.startsWith('v1.')).toBe(true);

    const test = (await call('POST', '/integrations/whatsapp/test', 'admin')).json();
    expect(test).toMatchObject({ ok: true, displayPhone: '+55 11 3000-1234', verifiedName: 'Atelier Imóveis' });
    const testCall = graphCalls.find((c) => c.url.includes(`/${PHONE_A}?fields=`))!;
    expect(testCall.auth).toBe(`Bearer ${TOKEN}`);
    expect((await call('GET', '/integrations/whatsapp', 'admin')).json().displayPhone).toBe('+55 11 3000-1234');

    // atualização parcial mantém os segredos existentes
    await call('PUT', '/integrations/whatsapp', 'admin', { wabaId: '55566677788' });
    expect((await call('POST', '/integrations/whatsapp/test', 'admin')).statusCode).toBe(200);

    // conectar a mesma conta em outra empresa é recusado; a outra empresa usa o seu próprio número
    const dup = await call('PUT', '/integrations/whatsapp', 'adminB', { phoneNumberId: PHONE_A, accessToken: TOKEN, appSecret: SECRET_B });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('WHATSAPP_PHONE_IN_USE');
    expect((await call('PUT', '/integrations/whatsapp', 'adminB', { phoneNumberId: PHONE_B, accessToken: TOKEN, appSecret: SECRET_B })).statusCode).toBe(200);

    graphFail = 'Invalid OAuth access token';
    fetchStub.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), { status: 401 }));
    const bad = await call('POST', '/integrations/whatsapp/test', 'admin');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('WHATSAPP_TEST_FAILED');
  });
});

describe('webhook', () => {
  it('verificação inicial devolve o desafio só com o token correto', async () => {
    const token = (await call('GET', '/integrations/whatsapp', 'admin')).json().verifyToken;
    const ok = await app.inject({ method: 'GET', url: `/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('1158201444');
    expect((await app.inject({ method: 'GET', url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/webhooks/meta/whatsapp' })).statusCode).toBe(403);
  });

  it('exige assinatura válida do app da empresa: sem assinatura, adulterada ou de outra empresa nada é gravado', async () => {
    const payload = inbound('Olá, quero informações', {}, '5511900000001');
    expect((await hook(payload, null)).statusCode).toBe(401);
    expect((await hook(payload, 'segredo-errado-1234567890')).statusCode).toBe(401);
    expect((await hook(payload, SECRET_B)).statusCode).toBe(401); // segredo de outra empresa
    const tampered = await app.inject({
      method: 'POST', url: '/webhooks/meta/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET_A).update(JSON.stringify(payload)).digest('hex')}` },
      payload: JSON.stringify(payload).replace('informações', 'informaçoes'),
    });
    expect(tampered.statusCode).toBe(401);
    expect(await prisma.message.count({ where: { conversation: { externalId: '5511900000001' } } })).toBe(0);
    expect((await hook(payload)).statusCode).toBe(200);
    expect(await prisma.message.count({ where: { conversation: { externalId: '5511900000001' } } })).toBe(1);
  });

  it('número desconhecido e eventos que não são de mensagens respondem 200 sem gravar nada', async () => {
    const before = await prisma.message.count();
    expect((await hook(inbound('oi', {}, '5511900000002', '123123123'))).statusCode).toBe(200);
    expect((await hook({ object: 'page', entry: [] })).statusCode).toBe(200);
    expect((await hook(envelope(PHONE_A, { messages: [{ from: WA_ID, id: 'wamid.RX1', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } }] }))).statusCode).toBe(200);
    expect(await prisma.message.count()).toBe(before);
  });
});

describe('recebimento', () => {
  it('cria cliente, lead, conversa e mensagem; liga o imóvel pelo código e herda a campanha do clique no site', async () => {
    const p = await publishedProperty();
    // o visitante clica no WhatsApp do site (com origem de campanha) e depois manda a mensagem
    await app.inject({ method: 'POST', url: '/api/v1/public/whatsapp-click', payload: { propertyId: p.id, utmSource: 'instagram', utmCampaign: 'verao', fbclid: 'IwAR-click', fbc: 'fb.1.1.IwAR-click' } });

    const res = await hook(inbound(`Olá! Tenho interesse no imóvel ${p.code} — Casa do WhatsApp. https://site/imovel/x`, { id: 'wamid.FIRST' }));
    expect(res.statusCode).toBe(200);

    const conv = await convOf();
    expect(conv).toMatchObject({ phone: WA_ID, contactName: 'Cliente WA', unreadCount: 1, windowOpen: true });
    expect(conv.lead).toMatchObject({ stage: { name: 'Novo' }, property: { code: p.code } });

    const lead = (await call('GET', `/leads/${conv.lead.id}`, 'admin')).json();
    expect(lead).toMatchObject({ source: 'WHATSAPP', status: 'NEW', propertyId: p.id });
    expect(lead.customer).toMatchObject({ name: 'Cliente WA', phone: '11977001122' }); // sem o 55, como no site
    expect(lead.attribution).toMatchObject({ utmSource: 'instagram', utmCampaign: 'verao', fbclid: 'IwAR-click', fbc: 'fb.1.1.IwAR-click' });
    expect(lead.timeline.map((t: { type: string }) => t.type)).toEqual(expect.arrayContaining(['LEAD_CREATED', 'WHATSAPP_RECEIVED']));
    const click = await prisma.whatsAppClick.findFirstOrThrow({ where: { propertyId: p.id } });
    expect(click.leadId).toBe(lead.id);

    const detail = (await call('GET', `/conversations/${conv.id}`, 'admin')).json();
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({ direction: 'INBOUND', status: 'RECEIVED', type: 'text' });
    expect(detail.messages[0].content).toContain(p.code);
    ids.lead = lead.id;
    ids.conv = conv.id;
  });

  it('é idempotente, agrupa mensagens no mesmo lead, conta não lidas e registra só o início da conversa na timeline', async () => {
    const dup = inbound('mensagem repetida', { id: 'wamid.FIRST' }); // mesmo wamid da mensagem anterior
    expect((await hook(dup)).statusCode).toBe(200);
    expect((await hook(inbound('Segunda mensagem', { id: 'wamid.SECOND' }))).statusCode).toBe(200);
    expect((await hook(inbound('Terceira mensagem', { id: 'wamid.THIRD' }))).statusCode).toBe(200);

    const detail = (await call('GET', `/conversations/${ids.conv}`, 'admin')).json();
    expect(detail.messages.map((m: { content: string }) => m.content)).toEqual([expect.stringContaining('IM'), 'Segunda mensagem', 'Terceira mensagem']);
    expect(detail.unreadCount).toBe(3);
    expect(detail.lastMessagePreview).toBe('Terceira mensagem');
    expect(await prisma.lead.count({ where: { customer: { phone: '11977001122' } } })).toBe(1);

    const timeline = (await call('GET', `/leads/${ids.lead}`, 'admin')).json().timeline;
    expect(timeline.filter((t: { type: string }) => t.type === 'WHATSAPP_RECEIVED')).toHaveLength(1); // sequência = 1 registro

    const board = (await call('GET', '/pipeline/board', 'admin')).json();
    const card = board.columns.flatMap((c: { leads: { id: string; unreadMessages: number }[] }) => c.leads).find((l: { id: string }) => l.id === ids.lead);
    expect(card.unreadMessages).toBe(3);
    expect((await call('GET', '/conversations/unread', 'admin')).json().unread).toBeGreaterThanOrEqual(3);

    graphCalls.length = 0;
    expect((await call('POST', `/conversations/${ids.conv}/read`, 'admin')).statusCode).toBe(200);
    expect((await convOf()).unreadCount).toBe(0);
    expect(graphCalls.find((c) => c.body?.status === 'read')?.body).toMatchObject({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.THIRD' });
  });

  it('depois que o lead é perdido, uma nova mensagem abre um novo lead na mesma conversa', async () => {
    const stages = (await call('GET', '/pipeline', 'admin')).json().stages;
    await call('POST', `/leads/${ids.lead}/change-stage`, 'admin', { stageId: stages.find((s: { name: string }) => s.name === 'Perdido').id, lostReason: 'Sem retorno' });
    await hook(inbound('Voltei! Ainda tem imóveis?', { id: 'wamid.BACK' }));
    const conv = await convOf();
    expect(conv.lead.id).not.toBe(ids.lead);
    expect(conv.id).toBe(ids.conv); // mesma conversa, lead novo
    expect(await prisma.lead.count({ where: { customer: { phone: '11977001122' } } })).toBe(2);
  });

  it('mídia recebida é baixada sob demanda, guardada no nosso storage e servida do cache depois', async () => {
    await hook(inbound('', { id: 'wamid.IMG1', type: 'image', text: undefined, image: { id: 'MEDIA1', mime_type: 'image/jpeg', caption: 'Planta do apto' } }, '5511977003344', PHONE_A, 'Maria'));
    const c = await convOf('admin', '5511977003344');
    const msg = (await call('GET', `/conversations/${c.id}`, 'admin')).json().messages[0];
    expect(msg).toMatchObject({ type: 'image', content: '[Imagem] Planta do apto', hasMedia: true, mediaUrl: null });

    graphCalls.length = 0;
    const r = (await call('GET', `/messages/${msg.id}/media`, 'admin')).json();
    expect(r.mime).toBe('image/jpeg');
    expect(graphCalls.map((g) => g.url.replace(/^.*\/v\d+\.\d+\//, ''))).toEqual(['MEDIA1', expect.stringContaining('lookaside')]);
    expect(graphCalls.every((g) => g.auth === `Bearer ${TOKEN}`)).toBe(true);
    const file = await app.inject({ method: 'GET', url: new URL(r.url, 'http://x').pathname });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.length).toBe(png.length);

    graphCalls.length = 0;
    expect((await call('GET', `/messages/${msg.id}/media`, 'admin')).json().url).toBe(r.url);
    expect(graphCalls).toHaveLength(0); // cache

    // mídia de outra empresa não é acessível; falha da Meta vira erro claro
    expect((await call('GET', `/messages/${msg.id}/media`, 'adminB')).statusCode).toBe(404);
    await hook(inbound('', { id: 'wamid.IMG2', type: 'image', text: undefined, image: { id: 'MEDIA2', mime_type: 'image/jpeg' } }, '5511977003344'));
    const second = (await call('GET', `/conversations/${c.id}`, 'admin')).json().messages.find((m: { content: string }) => m.content === '[Imagem]');
    mediaFail = true;
    const fail = await call('GET', `/messages/${second.id}/media`, 'admin');
    expect(fail.statusCode).toBe(502);
    expect(fail.json().code).toBe('WHATSAPP_MEDIA_UNAVAILABLE');
  });
});

describe('envio e status de entrega', () => {
  it('envia texto dentro da janela de 24h com a chamada correta à Meta e acompanha enviado → entregue → lido', async () => {
    const c = await convOf();
    graphCalls.length = 0;
    const sent = await call('POST', `/conversations/${c.id}/messages`, 'admin', { text: 'Oi! Posso te mostrar o imóvel amanhã?' });
    expect(sent.statusCode).toBe(201);
    const m = sent.json();
    expect(m).toMatchObject({ direction: 'OUTBOUND', status: 'SENT', type: 'text', sentBy: 'ADMIN A' });

    const g = graphCalls.find((x) => x.url.endsWith(`/${PHONE_A}/messages`))!;
    expect(g.url).toContain('graph.facebook.com');
    expect(g.auth).toBe(`Bearer ${TOKEN}`);
    expect(g.body).toMatchObject({ messaging_product: 'whatsapp', to: WA_ID, type: 'text', text: { body: 'Oi! Posso te mostrar o imóvel amanhã?' } });

    const wamid = (await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).externalId!;
    expect(wamid).toMatch(/^wamid\.OUT/);
    await hook(statusHook(wamid, 'delivered'));
    let cur = (await call('GET', `/conversations/${c.id}`, 'admin')).json().messages.find((x: { id: string }) => x.id === m.id);
    expect(cur.status).toBe('DELIVERED');
    expect(cur.deliveredAt).toBeTruthy();
    await hook(statusHook(wamid, 'read'));
    await hook(statusHook(wamid, 'delivered')); // chegou fora de ordem: não pode regredir
    await hook(statusHook(wamid, 'sent'));
    cur = (await call('GET', `/conversations/${c.id}`, 'admin')).json().messages.find((x: { id: string }) => x.id === m.id);
    expect(cur.status).toBe('READ');
    expect(cur.readAt).toBeTruthy();
    await hook(statusHook(wamid, 'failed', { errors: [{ code: 131026, title: 'Undeliverable' }] })); // atrasado: já foi lida
    expect((await call('GET', `/conversations/${c.id}`, 'admin')).json().messages.find((x: { id: string }) => x.id === m.id).status).toBe('READ');

    const tl = (await call('GET', `/leads/${c.lead.id}`, 'admin')).json().timeline;
    expect(tl.some((t: { type: string }) => t.type === 'WHATSAPP_SENT')).toBe(true);
  });

  it('falha de entrega informada pela Meta é registrada com o motivo', async () => {
    const c = await convOf();
    const m = (await call('POST', `/conversations/${c.id}/messages`, 'admin', { text: 'Teste de falha' })).json();
    const wamid = (await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).externalId!;
    await hook(statusHook(wamid, 'failed', { errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Número sem WhatsApp' } }] }));
    const cur = (await call('GET', `/conversations/${c.id}`, 'admin')).json().messages.find((x: { id: string }) => x.id === m.id);
    expect(cur).toMatchObject({ status: 'FAILED', error: 'Número sem WhatsApp' });
  });

  it('fora da janela de 24h só modelos aprovados são aceitos; erro da Meta vira FAILED e pode ser reenviado', async () => {
    const c = await convOf();
    await prisma.conversation.update({ where: { id: c.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await convOf()).windowOpen).toBe(false);

    const closed = await call('POST', `/conversations/${c.id}/messages`, 'admin', { text: 'Ainda está interessado?' });
    expect(closed.statusCode).toBe(422);
    expect(closed.json().code).toBe('WHATSAPP_WINDOW_CLOSED');
    expect((await call('POST', `/conversations/${c.id}/messages`, 'admin', {})).statusCode).toBe(400);
    expect((await call('POST', `/conversations/${c.id}/messages`, 'admin', { text: 'a', template: { name: 'x' } })).statusCode).toBe(400);
    expect((await call('POST', `/conversations/${c.id}/messages`, 'admin', { template: { name: 'Nome Inválido' } })).statusCode).toBe(400);

    graphCalls.length = 0;
    const tpl = await call('POST', `/conversations/${c.id}/messages`, 'admin', { template: { name: 'retomada_contato', language: 'pt_BR', params: ['Maria', 'Casa do WhatsApp'] } });
    expect(tpl.statusCode).toBe(201);
    expect(tpl.json()).toMatchObject({ type: 'template', status: 'SENT', content: '[Modelo] retomada_contato — Maria · Casa do WhatsApp' });
    expect(graphCalls.find((x) => x.body?.type === 'template')!.body.template).toEqual({
      name: 'retomada_contato', language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: 'Casa do WhatsApp' }] }],
    });

    graphFail = '(#131047) Re-engagement message';
    const failed = await call('POST', `/conversations/${c.id}/messages`, 'admin', { template: { name: 'outro_modelo' } });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().code).toBe('WHATSAPP_SEND_FAILED');
    expect(failed.json().message).toContain('Re-engagement');
    const bad = (await call('GET', `/conversations/${c.id}`, 'admin')).json().messages.find((x: { status: string; type: string }) => x.status === 'FAILED' && x.type === 'template');
    expect(bad.error).toContain('Re-engagement');

    graphFail = null;
    const retried = await call('POST', `/messages/${bad.id}/retry`, 'admin');
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ status: 'SENT', error: null });
    expect((await call('POST', `/messages/${bad.id}/retry`, 'admin')).json().code).toBe('MESSAGE_NOT_RETRYABLE'); // já enviada
  });
});

describe('visibilidade, permissões e isolamento', () => {
  it('corretor vê só as conversas dos seus leads; papéis sem lead.edit não enviam', async () => {
    const c = await convOf();
    expect((await call('GET', '/conversations', 'broker')).json().items.find((x: { id: string }) => x.id === c.id)).toBeUndefined();
    expect((await call('GET', `/conversations/${c.id}`, 'broker')).statusCode).toBe(404);
    expect((await call('POST', `/conversations/${c.id}/messages`, 'broker', { text: 'oi' })).statusCode).toBe(404);

    await call('POST', `/leads/${c.lead.id}/assign`, 'admin', { brokerId: ids.broker });
    expect((await call('GET', `/conversations/${c.id}`, 'broker')).statusCode).toBe(200);
    expect((await call('GET', '/conversations', 'broker')).json().items.map((x: { id: string }) => x.id)).toContain(c.id);
    expect((await call('GET', `/conversations?leadId=${c.lead.id}`, 'admin')).json().items).toHaveLength(1);
  });

  it('cada número roteia para a sua empresa; a outra empresa não vê nem envia nada da primeira', async () => {
    expect((await hook(inbound('Olá, empresa B', { id: 'wamid.B1' }, '5521955550000', PHONE_B), SECRET_A)).statusCode).toBe(401); // assinatura da empresa errada
    expect((await hook(inbound('Olá, empresa B', { id: 'wamid.B1' }, '5521955550000', PHONE_B), SECRET_B)).statusCode).toBe(200);

    const b = (await call('GET', '/conversations', 'adminB')).json();
    expect(b.items.map((x: { phone: string }) => x.phone)).toEqual(['5521955550000']);
    const a = (await call('GET', '/conversations?pageSize=100', 'admin')).json();
    expect(a.items.some((x: { phone: string }) => x.phone === '5521955550000')).toBe(false);

    const cA = await convOf();
    expect((await call('GET', `/conversations/${cA.id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('POST', `/conversations/${cA.id}/messages`, 'adminB', { text: 'invasão' })).statusCode).toBe(404);
    expect((await call('POST', `/conversations/${cA.id}/read`, 'adminB')).statusCode).toBe(404);
    expect(await prisma.lead.count({ where: { customer: { phone: '21955550000' } } })).toBe(1);
  });

  it('sem integração conectada o envio é recusado; desconectar apaga as credenciais', async () => {
    const c = await convOf();
    expect((await call('DELETE', '/integrations/whatsapp', 'admin')).statusCode).toBe(204);
    expect(await prisma.integration.count({ where: { externalId: PHONE_A } })).toBe(0);
    const res = await call('POST', `/conversations/${c.id}/messages`, 'admin', { text: 'sem integração' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('WHATSAPP_NOT_CONFIGURED');
    expect((await hook(inbound('depois de desconectar'))).statusCode).toBe(200); // número não cadastrado: ignorado
    const audit = (await call('GET', '/audit-logs?entity=INTEGRATION', 'admin')).json().items.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['CREATE', 'DELETE']));
    expect(JSON.stringify((await call('GET', '/audit-logs?entity=INTEGRATION', 'admin')).json())).not.toContain(TOKEN);
  });
});
