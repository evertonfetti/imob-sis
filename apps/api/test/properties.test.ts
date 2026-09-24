import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, login, resetAndSeed } from './helpers';

let app: NestFastifyApplication;
let admin: { accessToken: string; user: { companyId: string } };
let broker: { accessToken: string };
let adminB: { accessToken: string };
let typeId: string;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload: payload as never });

const newProperty = (over: object = {}) => ({
  title: 'Apartamento amplo no Centro', purpose: 'SALE', typeId, salePrice: 850000,
  minimumNegotiationPrice: 800000, city: 'São Paulo', neighborhood: 'Centro', bedrooms: 3, ...over,
});

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  admin = (await login(app, 'admin.a@teste.com')).body;
  broker = (await login(app, 'broker.a@teste.com')).body;
  adminB = (await login(app, 'admin.b@teste.com')).body;
  const types = (await call('GET', '/property-types', admin.accessToken)).json();
  typeId = types.find((t: { name: string }) => t.name === 'Apartamento').id;
});
afterAll(async () => { await app.close(); });

describe('imóveis', () => {
  it('cria com código, slug, corretor padrão e características; audita a criação', async () => {
    const features = (await call('GET', '/features', admin.accessToken)).json();
    const res = await call('POST', '/properties', admin.accessToken, newProperty({ featureIds: [features[0].id, features[1].id] }));
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p.code).toBe('IM0001');
    expect(p.slug).toBe('apartamento-amplo-no-centro-im0001');
    expect(p.status).toBe('DRAFT');
    expect(p.published).toBe(false);
    expect(p.features).toHaveLength(2);
    expect(p.salePrice).toBe(850000);

    const second = (await call('POST', '/properties', admin.accessToken, newProperty({ title: 'Outro' }))).json();
    expect(second.code).toBe('IM0002');
  });

  it('edita e registra somente os campos alterados (before/after) no histórico', async () => {
    const p = (await call('POST', '/properties', admin.accessToken, newProperty({ minimumNegotiationPrice: 700000 }))).json();
    const res = await call('PATCH', `/properties/${p.id}`, admin.accessToken, { salePrice: 799000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().salePrice).toBe(799000);

    const history = (await call('GET', `/properties/${p.id}/history`, admin.accessToken)).json();
    const update = history.find((h: { action: string }) => h.action === 'UPDATE');
    expect(update.before).toEqual({ salePrice: 850000 });
    expect(update.after).toEqual({ salePrice: 799000 });
  });

  it('rejeita valor mínimo de negociação maior que o preço com código específico', async () => {
    const res = await call('POST', '/properties', admin.accessToken, newProperty({ minimumNegotiationPrice: 900000 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PROPERTY_INVALID_PRICE');
  });

  it('publica só quando completo; despublica; arquiva; exclui apenas rascunho', async () => {
    const incomplete = (await call('POST', '/properties', admin.accessToken, newProperty({ salePrice: null, minimumNegotiationPrice: null }))).json();
    const fail = await call('POST', `/properties/${incomplete.id}/publish`, admin.accessToken);
    expect(fail.statusCode).toBe(422);
    expect(fail.json().code).toBe('PROPERTY_INCOMPLETE');
    expect(fail.json().details[0].field).toBe('salePrice');

    const ok = (await call('POST', '/properties', admin.accessToken, newProperty())).json();
    const pub = await call('POST', `/properties/${ok.id}/publish`, admin.accessToken);
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ published: true, status: 'AVAILABLE' });
    expect(pub.json().publishedAt).toBeTruthy();

    // título muda, mas o slug publicado não muda (SEO)
    const slug = pub.json().slug;
    const renamed = (await call('PATCH', `/properties/${ok.id}`, admin.accessToken, { title: 'Novo título' })).json();
    expect(renamed.slug).toBe(slug);

    expect((await call('DELETE', `/properties/${ok.id}`, admin.accessToken)).statusCode).toBe(409);
    const arch = (await call('POST', `/properties/${ok.id}/archive`, admin.accessToken)).json();
    expect(arch).toMatchObject({ status: 'ARCHIVED', published: false });

    expect((await call('DELETE', `/properties/${incomplete.id}`, admin.accessToken)).statusCode).toBe(204);
  });
});

describe('proprietários', () => {
  it('não permite excluir proprietário com imóveis; permite quando não há vínculo', async () => {
    const owner = (await call('POST', '/owners', admin.accessToken, { name: 'Maria Souza', type: 'PERSON', document: '123.456.789-00' })).json();
    const p = (await call('POST', '/properties', admin.accessToken, newProperty({ ownerId: owner.id }))).json();
    expect(p.owner.name).toBe('Maria Souza');
    const blocked = await call('DELETE', `/owners/${owner.id}`, admin.accessToken);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('OWNER_HAS_PROPERTIES');

    const free = (await call('POST', '/owners', admin.accessToken, { name: 'Sem imóveis' })).json();
    expect((await call('DELETE', `/owners/${free.id}`, admin.accessToken)).statusCode).toBe(204);
  });
});

describe('isolamento e permissões', () => {
  it('empresa B não vê, edita nem publica imóvel, proprietário ou tipo da empresa A', async () => {
    const owner = (await call('POST', '/owners', admin.accessToken, { name: 'Dono A' })).json();
    const p = (await call('POST', '/properties', admin.accessToken, newProperty())).json();

    expect((await call('GET', `/properties/${p.id}`, adminB.accessToken)).statusCode).toBe(404);
    expect((await call('PATCH', `/properties/${p.id}`, adminB.accessToken, { title: 'Hack' })).statusCode).toBe(404);
    expect((await call('POST', `/properties/${p.id}/publish`, adminB.accessToken)).statusCode).toBe(404);
    expect((await call('GET', `/owners/${owner.id}`, adminB.accessToken)).statusCode).toBe(404);
    expect((await call('GET', '/properties', adminB.accessToken)).json().total).toBe(0);

    // referência cruzada: B não pode usar tipo/proprietário de A
    const cross = await call('POST', '/properties', adminB.accessToken, newProperty({ ownerId: owner.id }));
    expect(cross.statusCode).toBe(400);
    const crossType = await call('POST', '/properties', adminB.accessToken, newProperty());
    expect(crossType.json().code).toBe('PROPERTY_TYPE_INVALID');
  });

  it('corretor cria/edita, mas não publica nem exclui; dados sensíveis só para quem edita', async () => {
    const p = (await call('POST', '/properties', broker.accessToken, newProperty())).json();
    expect(p.minimumNegotiationPrice).toBe(800000); // corretor tem property.edit
    expect((await call('POST', `/properties/${p.id}/publish`, broker.accessToken)).statusCode).toBe(403);
    expect((await call('DELETE', `/properties/${p.id}`, broker.accessToken)).statusCode).toBe(403);

    // atendente só visualiza: sem valor mínimo e sem proprietário
    const created = (await call('POST', '/users', admin.accessToken, {
      name: 'Atendente', email: 'atendente@teste.com', roleKey: 'ATTENDANT', password: 'Senha@12345',
    })).json();
    expect(created.id).toBeTruthy();
    const att = (await login(app, 'atendente@teste.com')).body;
    const view = (await call('GET', `/properties/${p.id}`, att.accessToken)).json();
    expect(view).not.toHaveProperty('minimumNegotiationPrice');
    expect(view).not.toHaveProperty('owner');
    expect((await call('GET', '/owners', att.accessToken)).statusCode).toBe(403);
  });
});
