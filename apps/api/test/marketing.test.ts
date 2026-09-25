import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auth, bootApp, login, resetAndSeed, uploadPhoto } from './helpers';

const PIXEL = '555444333222111';
const TOKEN = 'EAAGcapiTokenDeTesteDaMeta1234567890';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
let typeId: string;
let stages: { id: string; name: string }[];
const stage = (n: string) => stages.find((s) => s.name === n)!.id;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

// ---------- Meta simulada (CAPI) ----------
let capiFail: string | null = null;
let failTimes = 0; // falha só as N primeiras chamadas
const capiCalls: { url: string; auth: string | null; body: any }[] = [];
const fetchStub = vi.fn(async (input: any, init: any = {}) => {
  const url = String(input);
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes(`/${PIXEL}/events`)) {
    capiCalls.push({ url, auth: init.headers?.authorization ?? null, body: JSON.parse(init.body) });
    if (capiFail || failTimes > 0) { failTimes--; return json({ error: { message: capiFail ?? 'Erro temporário', code: 100 } }, 400); }
    return json({ events_received: 1, fbtrace_id: 'TRACE123' });
  }
  if (url.includes(`/${PIXEL}?fields=`)) return json({ id: PIXEL, name: 'Pixel Atelier' });
  return json({ error: { message: `sem rota simulada: ${url}` } }, 500);
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });
const events = async (q = '') => (await call('GET', `/marketing/events?pageSize=100${q}`, 'admin')).json().items as any[];
const lastCapi = () => capiCalls.at(-1)!.body.data[0];

let seq = 0;
async function publishedProperty(over: Record<string, unknown> = {}) {
  const p = (await call('POST', '/properties', 'admin', { title: 'Casa Marketing', purpose: 'SALE', typeId, salePrice: 800000, city: 'Campinas', neighborhood: 'Cambuí', ...over })).json();
  await uploadPhoto(app, tk.admin!, p.id);
  await call('POST', `/properties/${p.id}/publish`, 'admin');
  return p;
}
const siteLead = (over: Record<string, unknown> = {}, a: NestFastifyApplication = app) =>
  a.inject({
    method: 'POST', url: '/api/v1/public/leads', remoteAddress: '203.0.113.7', headers: { 'user-agent': 'Mozilla/5.0 (Teste)' },
    payload: { name: 'Marina Alves Souza', phone: `1197700${String(++seq).padStart(4, '0')}`, email: `Marina${seq}@Email.com`, consent: true, ...over },
  });
const leadIdOf = async (phone: string) => (await prisma.lead.findFirstOrThrow({ where: { customer: { phone } }, orderBy: { createdAt: 'desc' } })).id;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await resetAndSeed();
  app = await bootApp();
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
  stages = (await call('GET', '/pipeline', 'admin')).json().stages;
  const mk = (await call('POST', '/users', 'admin', { name: 'Gestor Marketing', email: 'mkt@teste.com', roleKey: 'MARKETING', password: 'Senha@12345' }));
  expect(mk.statusCode).toBe(201);
  tk.marketing = (await login(app, 'mkt@teste.com')).body.accessToken;
});
afterEach(() => { capiFail = null; failTimes = 0; });
afterAll(async () => { vi.unstubAllGlobals(); await app.close(); await prisma.$disconnect(); });

describe('conexão com a Meta', () => {
  it('guarda o token criptografado, nunca o devolve, valida com a Meta e respeita permissões', async () => {
    expect((await call('GET', '/marketing/integrations/meta', 'admin')).json()).toMatchObject({ connected: false, pixelId: null });
    expect((await call('PUT', '/marketing/integrations/meta', 'admin', { pixelId: PIXEL })).statusCode).toBe(400); // falta o token
    expect((await call('PUT', '/marketing/integrations/meta', 'admin', { pixelId: 'abc', accessToken: TOKEN })).statusCode).toBe(400);
    expect((await call('PUT', '/marketing/integrations/meta', 'broker', { pixelId: PIXEL, accessToken: TOKEN })).statusCode).toBe(403);

    const saved = (await call('PUT', '/marketing/integrations/meta', 'marketing', { pixelId: PIXEL, accessToken: TOKEN, testEventCode: 'TEST123' })).json();
    expect(saved).toMatchObject({ connected: true, pixelId: PIXEL, accessTokenSet: true, testEventCode: 'TEST123' });
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    const row = await prisma.integration.findFirstOrThrow({ where: { provider: 'META_CAPI' } });
    expect(row.secrets).not.toContain(TOKEN);

    expect((await call('POST', '/marketing/integrations/meta/test', 'admin')).json()).toMatchObject({ ok: true, pixelName: 'Pixel Atelier' });
    const site = await app.inject({ method: 'GET', url: '/api/v1/public/company' });
    expect(site.json().metaPixelId).toBe(PIXEL);
    expect(site.body).not.toContain(TOKEN);

    // evento de teste usa o código de teste da Meta e não entra no histórico
    capiCalls.length = 0;
    expect((await call('POST', '/marketing/integrations/meta/test-event', 'admin')).json()).toMatchObject({ ok: true, eventsReceived: 1 });
    expect(capiCalls[0]!.body.test_event_code).toBe('TEST123');
    expect(await events()).toHaveLength(0);
  });
});

describe('evento Lead (formulário do site)', () => {
  it('envia à Meta com dados pessoais só em hash, IP/navegador do visitante e o mesmo event_id do Pixel', async () => {
    const p = await publishedProperty();
    capiCalls.length = 0;
    const res = await siteLead({
      propertyId: p.id, name: 'Marina Alves Souza', phone: '(11) 97700-1234', email: '  Marina.Alves@Email.COM ',
      eventId: 'evt-browser-001', pageUrl: `https://site.com/imovel/${p.slug}`, marketingConsent: true, fbc: 'fb.1.1700000000.IwAR-abc', fbp: 'fb.1.1700000000.123456',
      utmSource: 'facebook', utmCampaign: 'lancamento',
    });
    expect(res.statusCode).toBe(201);

    expect(capiCalls).toHaveLength(1);
    expect(capiCalls[0]!.url).toContain(`/${PIXEL}/events`);
    expect(capiCalls[0]!.auth).toBe(`Bearer ${TOKEN}`); // token no cabeçalho, nunca na URL
    expect(capiCalls[0]!.url).not.toContain(TOKEN);
    const ev = lastCapi();
    expect(ev).toMatchObject({ event_name: 'Lead', event_id: 'evt-browser-001', action_source: 'website', event_source_url: `https://site.com/imovel/${p.slug}` });
    expect(ev.event_time).toBeGreaterThan(Date.now() / 1000 - 60);
    expect(ev.user_data).toMatchObject({
      em: [sha('marina.alves@email.com')], ph: [sha('5511977001234')], fn: [sha('marina')], ln: [sha('souza')],
      fbc: 'fb.1.1700000000.IwAR-abc', fbp: 'fb.1.1700000000.123456', client_ip_address: '203.0.113.7', client_user_agent: 'Mozilla/5.0 (Teste)',
    });
    expect(ev.user_data.external_id).toHaveLength(1);
    expect(ev.custom_data).toMatchObject({ content_ids: [p.code], content_type: 'home_listing' });
    const raw = JSON.stringify(capiCalls[0]!.body);
    for (const pii of ['marina.alves@email.com', '11977001234', '5511977001234', 'Marina', 'Souza']) expect(raw.toLowerCase()).not.toContain(pii.toLowerCase());

    const [row] = await events('&eventName=Lead');
    expect(row).toMatchObject({ eventName: 'Lead', eventId: 'evt-browser-001', status: 'SENT', attempts: 1 });
    expect(row.response).toMatchObject({ events_received: 1, fbtrace_id: 'TRACE123' });
    const stored = JSON.stringify(await prisma.marketingEvent.findFirstOrThrow({ where: { eventId: 'evt-browser-001' } }));
    expect(stored).not.toContain(TOKEN);
    expect(stored.toLowerCase()).not.toContain('marina.alves@email.com');
  });

  it('sem consentimento de marketing nada é enviado nem guardado: o evento fica "ignorado"', async () => {
    capiCalls.length = 0;
    await siteLead({ eventId: 'evt-sem-consent', marketingConsent: false, fbp: 'fb.1.1.999' });
    await siteLead({ eventId: 'evt-omitido' }); // consentimento não informado = recusado
    expect(capiCalls).toHaveLength(0);
    const rows = (await events()).filter((r) => ['evt-sem-consent', 'evt-omitido'].includes(r.eventId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'SKIPPED' && /consentimento/i.test(r.error))).toBe(true);
    const stored = await prisma.marketingEvent.findFirstOrThrow({ where: { eventId: 'evt-sem-consent' } });
    expect(stored.payload).toBeNull(); // nem os dados em hash ficam guardados
  });
});

describe('conversões por etapa do funil', () => {
  it('dispara o evento mapeado uma única vez por lead; Purchase leva o valor do imóvel; lead sem consentimento é ignorado', async () => {
    const p = await publishedProperty({ title: 'Casa para fechar', salePrice: 1250000 });
    await siteLead({ propertyId: p.id, phone: '11955550001', eventId: 'evt-fechar', marketingConsent: true, fbp: 'fb.1.1.555' });
    const leadId = await leadIdOf('11955550001');
    const move = (name: string, extra: object = {}) => call('POST', `/leads/${leadId}/change-stage`, 'admin', { stageId: stage(name), ...extra });
    capiCalls.length = 0;

    await move('Qualificado');
    expect(lastCapi()).toMatchObject({ event_name: 'QualifiedLead', event_id: `QualifiedLead-${leadId}`, action_source: 'system_generated' });
    expect(lastCapi().user_data.ph).toEqual([sha('5511955550001')]);
    await move('Proposta'); await move('Qualificado'); // volta à etapa: não reenvia
    expect(capiCalls.filter((c) => c.body.data[0].event_name === 'QualifiedLead')).toHaveLength(1);

    await move('Fechado');
    expect(lastCapi()).toMatchObject({ event_name: 'Purchase' });
    expect(lastCapi().custom_data).toMatchObject({ currency: 'BRL', value: 1250000, content_ids: [p.code] });

    // lead criado à mão (sem visitante, sem consentimento) não envia nada
    const manual = (await call('POST', '/leads', 'admin', { customer: { name: 'Cliente Manual', phone: '11955550002', email: 'manual@teste.com' } })).json();
    capiCalls.length = 0;
    await call('POST', `/leads/${manual.id}/change-stage`, 'admin', { stageId: stage('Qualificado') });
    expect(capiCalls).toHaveLength(0);
    const skipped = (await events('&status=SKIPPED')).find((r) => r.lead?.id === manual.id);
    expect(skipped).toMatchObject({ eventName: 'QualifiedLead', status: 'SKIPPED' });
  });

  it('o mapeamento etapa → evento é configurável por quem gerencia marketing', async () => {
    await siteLead({ phone: '11955550003', eventId: 'evt-mapa', marketingConsent: true, fbp: 'fb.1.1.777' });
    const leadId = await leadIdOf('11955550003');
    expect((await call('PATCH', `/marketing/stage-events/${stage('Proposta')}`, 'broker', { metaEvent: 'Schedule' })).statusCode).toBe(403);
    expect((await call('PATCH', `/marketing/stage-events/${stage('Proposta')}`, 'admin', { metaEvent: 'Lead' })).statusCode).toBe(400); // só eventos de etapa
    const set = await call('PATCH', `/marketing/stage-events/${stage('Proposta')}`, 'marketing', { metaEvent: 'Schedule' });
    expect(set.json()).toMatchObject({ metaEvent: 'Schedule' });
    expect((await call('GET', '/pipeline', 'admin')).json().stages.find((s: { name: string }) => s.name === 'Proposta').metaEvent).toBe('Schedule');

    capiCalls.length = 0;
    await call('POST', `/leads/${leadId}/change-stage`, 'admin', { stageId: stage('Proposta') });
    expect(lastCapi()).toMatchObject({ event_name: 'Schedule', event_id: `Schedule-${leadId}` });

    await call('PATCH', `/marketing/stage-events/${stage('Proposta')}`, 'admin', { metaEvent: null });
    await siteLead({ phone: '11955550004', eventId: 'evt-mapa-2', marketingConsent: true, fbp: 'fb.1.1.778' });
    const other = await leadIdOf('11955550004');
    capiCalls.length = 0;
    await call('POST', `/leads/${other}/change-stage`, 'admin', { stageId: stage('Proposta') });
    expect(capiCalls).toHaveLength(0); // sem mapeamento não há evento

    const audit = (await call('GET', '/audit-logs?entity=PIPELINE_STAGE', 'admin')).json().items;
    expect(audit.some((a: { after: { metaEvent: string | null } }) => a.after?.metaEvent === 'Schedule')).toBe(true);
  });
});

describe('evento Contact (clique no WhatsApp)', () => {
  it('envia com fbc/fbp do visitante e ignora quando ele recusou os cookies', async () => {
    const click = (over: object) => app.inject({ method: 'POST', url: '/api/v1/public/whatsapp-click', remoteAddress: '198.51.100.9', headers: { 'user-agent': 'Safari/17' }, payload: over });
    capiCalls.length = 0;
    expect((await click({ eventId: 'evt-click-1', pageUrl: 'https://site.com/imoveis', marketingConsent: true, fbc: 'fb.1.1.IwAR-click', fbp: 'fb.1.1.000' })).statusCode).toBe(204);
    expect(lastCapi()).toMatchObject({ event_name: 'Contact', event_id: 'evt-click-1', action_source: 'website', event_source_url: 'https://site.com/imoveis' });
    expect(lastCapi().user_data).toMatchObject({ fbc: 'fb.1.1.IwAR-click', fbp: 'fb.1.1.000', client_ip_address: '198.51.100.9', client_user_agent: 'Safari/17' });

    capiCalls.length = 0;
    await click({ eventId: 'evt-click-2', marketingConsent: false, fbp: 'fb.1.1.111' });
    expect(capiCalls).toHaveLength(0); // recusou os cookies: nada vai à Meta, mesmo com fbp
    const skipped = (await events('&eventName=Contact&status=SKIPPED')).map((r) => r.error);
    expect(skipped.some((e: string) => /consentimento/i.test(e))).toBe(true);
    expect((await prisma.marketingEvent.findFirstOrThrow({ where: { eventId: 'evt-click-2' } })).payload).toBeNull();

    // consentiu, mas sem fbc/fbp: ainda há IP e navegador do visitante (a Meta aceita, com menor qualidade de correspondência)
    await click({ eventId: 'evt-click-3', marketingConsent: true });
    expect(capiCalls).toHaveLength(1);
    expect(Object.keys(lastCapi().user_data).sort()).toEqual(['client_ip_address', 'client_user_agent']);
  });
});

describe('falhas e reenvio', () => {
  it('erro da Meta vira FAILED com o motivo; reenvio manual funciona; só eventos que falharam podem ser reenviados', async () => {
    capiFail = 'Invalid parameter: event_time';
    await siteLead({ phone: '11955550005', eventId: 'evt-falha', marketingConsent: true, fbp: 'fb.1.1.222' });
    const failed = (await events('&status=FAILED')).find((r) => r.eventId === 'evt-falha');
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(failed.error).toContain('Invalid parameter');

    expect((await call('POST', `/marketing/events/${failed.id}/retry`, 'broker')).statusCode).toBe(403);
    capiFail = null;
    const ok = await call('POST', `/marketing/events/${failed.id}/retry`, 'marketing');
    expect(ok.statusCode).toBe(200);
    const after = (await events()).find((r) => r.id === failed.id);
    expect(after).toMatchObject({ status: 'SENT', attempts: 2, error: null });
    expect((await call('POST', `/marketing/events/${failed.id}/retry`, 'admin')).json().code).toBe('MARKETING_EVENT_NOT_RETRYABLE');
    expect((await call('POST', `/marketing/events/${failed.id}/retry`, 'adminB')).statusCode).toBe(404);
  });
});

describe.skipIf(!process.env.TEST_REDIS_URL)('fila com tentativas limitadas (BullMQ)', () => {
  it('tenta até 3 vezes com espera crescente: recupera na 2ª tentativa; se todas falham, fica FAILED com attempts = 3', async () => {
    const queued = await bootApp({ REDIS_URL: process.env.TEST_REDIS_URL!, MARKETING_RETRY_DELAY_MS: '30' });
    try {
      const tq = (await login(queued, 'admin.a@teste.com')).body.accessToken;
      const wait = async (id: string, want: string) => {
        for (let i = 0; i < 60; i++) {
          const r = await prisma.marketingEvent.findFirstOrThrow({ where: { eventId: id } });
          if (r.status === want) return r;
          await new Promise((res) => setTimeout(res, 100));
        }
        return prisma.marketingEvent.findFirstOrThrow({ where: { eventId: id } });
      };
      const send = (eventId: string, phone: string) => queued.inject({ method: 'POST', url: '/api/v1/public/leads', payload: { name: 'Fila Teste', phone, consent: true, eventId, marketingConsent: true, fbp: 'fb.1.1.333' } });

      failTimes = 1; // 1ª chamada falha, 2ª passa
      await send('evt-fila-ok', '11955550006');
      const ok = await wait('evt-fila-ok', 'SENT');
      expect(ok).toMatchObject({ status: 'SENT', attempts: 2 });

      capiFail = 'Meta fora do ar';
      await send('evt-fila-falha', '11955550007');
      const bad = await wait('evt-fila-falha', 'FAILED');
      expect(bad).toMatchObject({ status: 'FAILED', attempts: 3, error: 'Meta fora do ar' });
      expect(tq).toBeTruthy();
    } finally {
      await queued.close();
    }
  });
});

describe('relatórios de campanhas', () => {
  it('mostra por campanha: leads, qualificados, fechados, valor fechado, cliques no WhatsApp e taxas', async () => {
    const p = await publishedProperty({ title: 'Casa Relatório', salePrice: 500000 });
    const mk = async (phone: string, utm: object, stageName?: string) => {
      await siteLead({ phone, propertyId: p.id, eventId: `evt-${phone}`, marketingConsent: true, fbp: `fb.1.1.${phone}`, ...utm });
      const id = await leadIdOf(phone);
      if (stageName) await call('POST', `/leads/${id}/change-stage`, 'admin', { stageId: stage(stageName) });
    };
    await mk('11944440001', { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'busca-casas' }, 'Fechado'); // ganho (passou por Fechado, sem Qualificado)
    await mk('11944440002', { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'busca-casas' }, 'Qualificado');
    await mk('11944440003', { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'busca-casas' });
    await mk('11944440004', { utmSource: 'Facebook', utmMedium: 'social', utmCampaign: 'Lancamento-Verao' }, 'Qualificado');
    await mk('11944440005', {});
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/v1/public/whatsapp-click', payload: { propertyId: p.id, utmSource: 'facebook', utmMedium: 'social', utmCampaign: 'lancamento-verao' } });

    const rows = (await call('GET', '/marketing/campaigns?days=30', 'marketing')).json() as any[];
    const google = rows.find((r) => r.campaign === 'busca-casas')!;
    expect(google).toMatchObject({ source: 'google', medium: 'cpc', leads: 3, qualified: 1, won: 1, lost: 0, wonValue: 500000 });
    expect(google.qualifiedRate).toBeCloseTo(1 / 3);
    expect(google.wonRate).toBeCloseTo(1 / 3);
    const fb = rows.find((r) => r.campaign === 'lancamento-verao')!;
    expect(rows.filter((r) => r.campaign === 'lancamento-verao')).toHaveLength(1); // "Facebook" e "facebook" são a mesma origem
    expect(fb).toMatchObject({ source: 'facebook', medium: 'social', leads: 1, qualified: 1, won: 0, whatsappClicks: 3 });
    expect(rows.find((r) => r.campaign === '(sem campanha)')).toMatchObject({ source: '(direto / sem origem)', leads: expect.any(Number) });
    expect(rows[0]!.leads).toBeGreaterThanOrEqual(rows.at(-1)!.leads); // ordenado por volume

    const sources = (await call('GET', '/marketing/sources?days=30', 'marketing')).json();
    expect(sources.channels.find((c: { key: string }) => c.key === 'SITE').leads).toBeGreaterThanOrEqual(5);
    expect(sources.utm.find((u: { key: string }) => u.key === 'google')).toMatchObject({ leads: 3, qualified: 1, won: 1 });
    expect(sources.utm.filter((u: { key: string }) => u.key === 'facebook')).toHaveLength(1); // "Facebook" e "facebook" viram uma origem só
    expect(sources.utm.some((u: { key: string }) => u.key === 'Facebook')).toBe(false);
    expect(sources.utm.find((u: { key: string }) => u.key === 'facebook').leads).toBeGreaterThanOrEqual(2); // este teste + o lead do teste anterior

    const ov = (await call('GET', '/marketing/overview?days=7', 'marketing')).json();
    expect(ov).toMatchObject({ days: 7, whatsappClicks: expect.any(Number) });
    expect(ov.leads).toBeGreaterThanOrEqual(5);
    expect(ov.series.length).toBeGreaterThanOrEqual(7);
    expect(ov.series.reduce((n: number, d: { leads: number }) => n + d.leads, 0)).toBe(ov.leads);
    expect(ov.events.SENT).toBeGreaterThan(0);
  });

  it('valida o período e respeita permissão e empresa', async () => {
    expect((await call('GET', '/marketing/campaigns?days=5', 'admin')).statusCode).toBe(400);
    expect((await call('GET', '/marketing/campaigns', 'broker')).statusCode).toBe(403); // sem marketing.view
    expect((await call('GET', '/marketing/campaigns', 'admin')).statusCode).toBe(200); // padrão: 30 dias
    const b = (await call('GET', '/marketing/overview', 'adminB')).json();
    expect(b).toMatchObject({ leads: 0, whatsappClicks: 0, events: {} });
    expect((await call('GET', '/marketing/campaigns', 'adminB')).json()).toEqual([]);
    expect((await call('GET', '/marketing/events', 'adminB')).json().total).toBe(0);
    expect((await call('GET', '/marketing/integrations/meta', 'adminB')).json()).toMatchObject({ connected: false });
  });
});

describe('desconectar', () => {
  it('sem Meta conectada nenhum evento é gerado; o Pixel some do site', async () => {
    expect((await call('DELETE', '/marketing/integrations/meta', 'admin')).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/company' })).json().metaPixelId).toBeNull();
    const before = await prisma.marketingEvent.count();
    capiCalls.length = 0;
    await siteLead({ phone: '11955550099', eventId: 'evt-desconectado', marketingConsent: true, fbp: 'fb.1.1.444' });
    expect(capiCalls).toHaveLength(0);
    expect(await prisma.marketingEvent.count()).toBe(before);
    expect((await call('POST', '/marketing/integrations/meta/test', 'admin')).json().code).toBe('META_NOT_CONFIGURED');
  });
});
