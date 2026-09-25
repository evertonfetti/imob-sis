import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, login, resetAndSeed, uploadPhoto } from './helpers';

let app: NestFastifyApplication;
let admin: { accessToken: string; user: { companyId: string } };
let adminB: { accessToken: string; user: { companyId: string } };
let typeIds: Record<string, string>;
let featureIds: Record<string, string>;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload: payload as never });
const pub = (url: string, a: NestFastifyApplication = app) => a.inject({ method: 'GET', url: `/api/v1/public${url}` });
const postLead = (body: object, a: NestFastifyApplication = app) =>
  a.inject({ method: 'POST', url: '/api/v1/public/leads', payload: { name: 'Carlos Lima', phone: '(11) 98888-7777', consent: true, ...body } });

/** Cria um imóvel completo e (opcionalmente) publica. */
async function makeProperty(over: Record<string, unknown> = {}, { publish = true, photo = true } = {}) {
  const res = await call('POST', '/properties', admin.accessToken, {
    title: 'Apartamento Jardins', purpose: 'SALE', typeId: typeIds.Apartamento, salePrice: 900000, minimumNegotiationPrice: 850000,
    city: 'São Paulo', neighborhood: 'Jardins', address: 'Rua Secreta', number: '123', zipCode: '01000-000', latitude: -23.5, longitude: -46.6,
    bedrooms: 3, ...over,
  });
  const p = res.json();
  if (photo) await uploadPhoto(app, admin.accessToken, p.id);
  if (publish) await call('POST', `/properties/${p.id}/publish`, admin.accessToken);
  return p;
}

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  admin = (await login(app, 'admin.a@teste.com')).body;
  adminB = (await login(app, 'admin.b@teste.com')).body;
  typeIds = Object.fromEntries((await call('GET', '/property-types', admin.accessToken)).json().map((t: { name: string; id: string }) => [t.name, t.id]));
  featureIds = Object.fromEntries((await call('GET', '/features', admin.accessToken)).json().map((f: { slug: string; id: string }) => [f.slug, f.id]));
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('site público: dados expostos', () => {
  it('lista só imóveis publicados e disponíveis, sem vazar dados privados', async () => {
    const owner = (await call('POST', '/owners', admin.accessToken, { name: 'Dono Confidencial', document: '111.222.333-44' })).json();
    const live = await makeProperty({ ownerId: owner.id });
    const draft = await makeProperty({ title: 'Rascunho Secreto' }, { publish: false });
    const archived = await makeProperty({ title: 'Arquivado' });
    await call('POST', `/properties/${archived.id}/archive`, admin.accessToken);
    const sold = await makeProperty({ title: 'Já vendido' });
    await call('PATCH', `/properties/${sold.id}`, admin.accessToken, { status: 'SOLD' });

    const res = await pub('/properties');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([live.id]);
    expect(body.items[0].coverUrl).toBeTruthy();
    const raw = res.body;
    for (const secret of ['Dono Confidencial', '111.222.333-44', 'minimumNegotiationPrice', '850000', 'Rua Secreta', 'ownerId', 'brokerId', 'companyId', 'Rascunho Secreto']) {
      expect(raw).not.toContain(secret);
    }
    expect(draft.id).toBeTruthy();
  });

  it('detalhe: endereço exato e coordenadas só quando permitido; documentos nunca; vendido acessível com status', async () => {
    const p = await makeProperty({ title: 'Casa Reservada Endereço', showExactAddress: false });
    await uploadPhoto(app, admin.accessToken, p.id, { contentType: 'application/pdf', type: 'DOCUMENT', buffer: Buffer.from('%PDF-1.4 escritura') });
    const hidden = (await pub(`/properties/${p.slug}`)).json();
    expect(hidden).toMatchObject({ address: null, number: null, zipCode: null, latitude: null, longitude: null, neighborhood: 'Jardins' });
    expect(hidden.media.every((m: { type: string }) => m.type !== 'DOCUMENT')).toBe(true);
    expect(hidden.media.length).toBe(1);
    expect(JSON.stringify(hidden)).not.toContain('escritura');

    await call('PATCH', `/properties/${p.id}`, admin.accessToken, { showExactAddress: true });
    const exact = (await pub(`/properties/${p.slug}`)).json();
    expect(exact).toMatchObject({ address: 'Rua Secreta', number: '123', latitude: -23.5 });

    await call('PATCH', `/properties/${p.id}`, admin.accessToken, { status: 'SOLD' });
    const sold = await pub(`/properties/${p.slug}`);
    expect(sold.statusCode).toBe(200);
    expect(sold.json().status).toBe('SOLD');

    await call('POST', `/properties/${p.id}/unpublish`, admin.accessToken);
    expect((await pub(`/properties/${p.slug}`)).statusCode).toBe(404);
    expect((await pub('/properties/nao-existe')).statusCode).toBe(404);
  });
});

describe('site público: busca', () => {
  it('filtra por finalidade (venda e aluguel inclui os dois), preço, tipo, características e ordena', async () => {
    const rent = await makeProperty({ title: 'Kitnet Aluguel', purpose: 'RENT', typeId: typeIds.Kitnet, salePrice: null, minimumNegotiationPrice: null, rentPrice: 2500, city: 'Santos', neighborhood: 'Gonzaga', bedrooms: 1 });
    const both = await makeProperty({ title: 'Casa Venda e Aluguel', purpose: 'SALE_AND_RENT', typeId: typeIds.Casa, salePrice: 1200000, minimumNegotiationPrice: 1100000, rentPrice: 6000, city: 'Santos', neighborhood: 'Gonzaga', bedrooms: 4, featureIds: [featureIds.piscina!] });

    const ids = async (qs: string) => (await pub(`/properties?${qs}`)).json().items.map((i: { id: string }) => i.id);
    const forRent = await ids('purpose=RENT');
    expect(forRent).toEqual(expect.arrayContaining([rent.id, both.id]));
    expect(await ids('purpose=SALE')).not.toContain(rent.id);
    expect(await ids('purpose=SALE')).toContain(both.id);

    expect(await ids('purpose=RENT&priceMax=3000')).toEqual([rent.id]); // preço de aluguel, não de venda
    expect(await ids('type=kitnet')).toEqual([rent.id]);
    expect(await ids('type=tipo-inexistente')).toEqual([]);
    expect(await ids('features=piscina')).toEqual([both.id]);
    expect(await ids('features=piscina,inexistente')).toEqual([]);
    expect(await ids('city=santos&bedrooms=3')).toEqual([both.id]);

    const asc = (await pub('/properties?purpose=SALE&sort=price_asc')).json().items.map((i: { salePrice: number }) => i.salePrice);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = (await pub('/properties?purpose=SALE&sort=price_desc')).json().items.map((i: { salePrice: number }) => i.salePrice);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));

    const filters = (await pub('/filters')).json();
    expect(filters.cities.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Santos', 'São Paulo']));
    expect(filters.types.map((t: { slug: string }) => t.slug)).toContain('kitnet');
    expect(filters.features.map((f: { slug: string }) => f.slug)).toContain('piscina');
  });

  it('sitemap traz apenas publicados', async () => {
    const draft = await makeProperty({ title: 'Fora do sitemap' }, { publish: false });
    const slugs = (await pub('/sitemap')).json().map((s: { slug: string }) => s.slug);
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs).not.toContain(draft.slug);
  });
});

describe('site público: formulário de interesse', () => {
  it('cria cliente, lead e atribuição; atribui ao corretor do imóvel; não duplica em 24h nem o cliente', async () => {
    const p = await makeProperty({ title: 'Imóvel do formulário' });
    const attribution = { utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'lancamento', fbclid: 'IwAR123', fbc: 'fb.1.1.IwAR123', fbp: 'fb.1.2.3', landingPage: 'https://site/imovel/x', referrer: 'https://facebook.com' };
    const res = await postLead({ propertyId: p.id, email: 'CARLOS@Mail.com', message: 'Quero visitar', ...attribution });
    expect(res.statusCode).toBe(201);

    const leads = (await call('GET', '/leads', admin.accessToken)).json();
    const lead = leads.items.find((l: { property: { id: string } | null }) => l.property?.id === p.id);
    expect(lead).toMatchObject({ source: 'SITE', status: 'NEW' });
    expect(lead.customer).toMatchObject({ name: 'Carlos Lima', phone: '11988887777', email: 'carlos@mail.com' });
    expect(lead.broker.id).toBe(admin.user ? (await call('GET', `/properties/${p.id}`, admin.accessToken)).json().brokerId : '');
    expect(lead.attribution).toMatchObject({ utmSource: 'facebook', utmCampaign: 'lancamento', fbclid: 'IwAR123' });
    const stored = await prisma.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(stored).toMatchObject({ fbc: 'fb.1.1.IwAR123', fbp: 'fb.1.2.3', referrer: 'https://facebook.com' });

    // mesmo interesse de novo: nenhum lead novo
    await postLead({ propertyId: p.id, message: 'Reenviando' });
    // outro imóvel, mesmo telefone com formatação diferente: novo lead, mesmo cliente
    const p2 = await makeProperty({ title: 'Outro imóvel do formulário' });
    await postLead({ propertyId: p2.id, phone: '+55 11 98888-7777' });

    const after = (await call('GET', '/leads?pageSize=100', admin.accessToken)).json().items;
    expect(after.filter((l: { property: { id: string } | null }) => l.property?.id === p.id)).toHaveLength(1);
    expect(after.filter((l: { property: { id: string } | null }) => l.property?.id === p2.id)).toHaveLength(1);
    expect(await prisma.customer.count({ where: { companyId: admin.user.companyId, phone: '11988887777' } })).toBe(1);

    const audit = (await call('GET', '/audit-logs?entity=LEAD', admin.accessToken)).json();
    expect(audit.items.some((a: { action: string; userId: string | null }) => a.action === 'CREATE' && a.userId === null)).toBe(true);
  });

  it('valida entrada, exige consentimento, ignora robôs (honeypot) e recusa imóvel não publicado', async () => {
    const bad = await postLead({ phone: '123' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('VALIDATION_FAILED');
    expect((await postLead({ consent: false })).statusCode).toBe(400);

    const before = await prisma.lead.count();
    const bot = await postLead({ name: 'Robô Spam', phone: '11977776666', website: 'http://spam.example' });
    expect(bot.statusCode).toBe(201); // não revela ao robô
    expect(await prisma.lead.count()).toBe(before);

    const draft = await makeProperty({ title: 'Ainda rascunho' }, { publish: false });
    const res = await postLead({ propertyId: draft.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('LEAD_PROPERTY_INVALID');
  });

  it('registra o clique no WhatsApp com a origem da campanha', async () => {
    const p = await makeProperty({ title: 'Com WhatsApp' });
    const before = await prisma.whatsAppClick.count();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/public/whatsapp-click',
      payload: { propertyId: p.id, sessionId: 's-1', visitorId: 'v-1', utmSource: 'instagram', utmCampaign: 'verao', fbclid: 'abc' },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.whatsAppClick.count()).toBe(before + 1);
    const click = await prisma.whatsAppClick.findFirstOrThrow({ where: { propertyId: p.id } });
    expect(click).toMatchObject({ sessionId: 's-1', visitorId: 'v-1', utmSource: 'instagram', utmCampaign: 'verao', fbclid: 'abc' });
  });
});

describe('multiempresa no site e nos leads', () => {
  it('cada site mostra só a sua empresa e cada painel só os seus leads', async () => {
    const siteB = await bootApp({ PUBLIC_COMPANY_ID: adminB.user.companyId });
    try {
      expect((await pub('/properties', siteB)).json().total).toBe(0); // empresa B não tem imóveis publicados
      const bTypes = (await siteB.inject({ method: 'GET', url: '/api/v1/property-types', headers: auth(adminB.accessToken) })).json();
      const created = (await siteB.inject({ method: 'POST', url: '/api/v1/properties', headers: auth(adminB.accessToken), payload: { title: 'Imóvel B', purpose: 'SALE', typeId: bTypes[0].id, salePrice: 1, city: 'X', neighborhood: 'Y' } })).json();
      await uploadPhoto(siteB, adminB.accessToken, created.id);
      await siteB.inject({ method: 'POST', url: `/api/v1/properties/${created.id}/publish`, headers: auth(adminB.accessToken) });

      expect((await pub('/properties', siteB)).json().items.map((i: { title: string }) => i.title)).toEqual(['Imóvel B']);
      // imóvel da empresa A não é aceito no site da B
      const aProp = (await pub('/properties')).json().items[0];
      expect((await postLead({ propertyId: aProp.id }, siteB)).json().code).toBe('LEAD_PROPERTY_INVALID');

      await postLead({ propertyId: created.id, phone: '21955554444' }, siteB);
      const leadsB = (await call('GET', '/leads', adminB.accessToken)).json();
      expect(leadsB.total).toBe(1);
      const leadsA = (await call('GET', '/leads?pageSize=100', admin.accessToken)).json();
      expect(leadsA.items.every((l: { customer: { phone: string } }) => l.customer.phone !== '21955554444')).toBe(true);
    } finally {
      await siteB.close();
    }
  });
});
