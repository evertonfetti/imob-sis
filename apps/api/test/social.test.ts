import { createPrismaClient } from '@imob/database';
import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SocialPublisher } from '../src/social/social-publisher.service';
import { auth, bootApp, login, makeImage, resetAndSeed, uploadPhoto } from './helpers';

const ADMIN_URL = 'http://localhost:5173';
const SOCIAL_ENV = { META_APP_ID: '1234567890', META_APP_SECRET: 'app-secret-social-1234567890', API_PUBLIC_URL: 'https://api.teste.com.br', SITE_URL: 'https://site.teste.com.br', SOCIAL_POLL_MS: '1' };

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
let typeId: string;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

// ---------- Graph API simulada ----------
interface Call { method: string; path: string; body: any; auth: string | null; query: URLSearchParams }
const calls: Call[] = [];
let fail: { match: RegExp; times: number; status?: number; code: number; message: string }[] = [];
let n = 0;
const PAGES = [
  { id: 'PAGE1', name: 'Atelier Imóveis', access_token: 'PAGE-TOKEN-1', picture: { data: { url: 'https://cdn/p1.jpg' } }, instagram_business_account: { id: 'IG1', username: 'atelierimoveis', profile_picture_url: 'https://cdn/ig1.jpg' } },
  { id: 'PAGE2', name: 'Outra Página', access_token: 'PAGE-TOKEN-2' },
];
const fetchStub = vi.fn(async (input: any, init: any = {}) => {
  const u = new URL(String(input));
  const path = u.pathname.replace(/^\/v\d+\.\d+\//, '');
  const call: Call = { method: init.method ?? 'GET', path, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization ?? null, query: u.searchParams };
  calls.push(call);
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  const rule = fail.find((f) => f.times > 0 && f.match.test(`${call.method} ${path}`));
  if (rule) { rule.times--; return json({ error: { message: rule.message, code: rule.code } }, rule.status ?? 400); }

  if (path === 'oauth/access_token') return json({ access_token: u.searchParams.get('grant_type') === 'fb_exchange_token' ? 'LONG-USER-TOKEN' : 'SHORT-USER-TOKEN' });
  if (path === 'me/accounts') return json({ data: PAGES });
  if (/^(PAGE\d)\/photos$/.test(path)) return json(call.body?.published === false ? { id: `photo-${++n}` } : { id: `photo-${++n}`, post_id: `${path.split('/')[0]}_post${n}` });
  if (/\/feed$/.test(path)) return json({ id: `PAGE1_feed${++n}` });
  if (/^IG\d\/media$/.test(path)) return json({ id: `container-${++n}` });
  if (/^IG\d\/media_publish$/.test(path)) return json({ id: `igmedia-${++n}` });
  if (/^container-/.test(path)) return json({ status_code: 'FINISHED' });
  if (/^igmedia-/.test(path)) return json({ permalink: `https://instagram.com/p/${path}` });
  if (/^PAGE\d_/.test(path)) return json({ permalink_url: `https://facebook.com/${path}` });
  if (/^PAGE\d$/.test(path)) return json({ id: path, name: 'Atelier Imóveis' });
  return json({ error: { message: `sem rota simulada: ${path}` } }, 500);
});
const graph = (re: RegExp) => calls.filter((c) => re.test(`${c.method} ${c.path}`));

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });
const tick = () => app.get(SocialPublisher).tick();

let prop: { id: string; code: string; slug: string };
let mediaIds: string[];
let fbId: string;
let igId: string;

async function connectAccounts(who = 'marketing', a: NestFastifyApplication = app) {
  const url = new URL((await a.inject({ method: 'POST', url: '/api/v1/social/connect', headers: auth(tk[who]!) })).json().url);
  const cb = await a.inject({ method: 'GET', url: `/api/v1/social/oauth/callback?code=CODE123&state=${encodeURIComponent(url.searchParams.get('state')!)}` });
  return { url, cb };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await resetAndSeed();
  app = await bootApp(SOCIAL_ENV);
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  await call('POST', '/users', 'admin', { name: 'Gestor Social', email: 'social@teste.com', roleKey: 'MARKETING', password: 'Senha@12345' });
  tk.marketing = (await login(app, 'social@teste.com')).body.accessToken;
  await call('POST', '/users', 'admin', { name: 'Gerente Vendas', email: 'gerente@teste.com', roleKey: 'MANAGER', password: 'Senha@12345' });
  tk.manager = (await login(app, 'gerente@teste.com')).body.accessToken;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;

  prop = (await call('POST', '/properties', 'admin', {
    title: 'Casa com piscina em condomínio', purpose: 'SALE', typeId, salePrice: 1450000, city: 'Campinas', neighborhood: 'Swiss Park', bedrooms: 4, suites: 3, parkingSpaces: 4, usefulArea: 310,
    description: 'Casa térrea de arquitetura contemporânea, com grandes vãos de vidro e integração total entre sala, cozinha e varanda gourmet.\n\nPiscina aquecida e jardim paisagístico.',
  })).json();
  const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#a09070' } }).png().toBuffer(); // 3:1, fora do que o Instagram aceita
  const ids: string[] = [];
  for (const buffer of [await makeImage(1200, 800), wide, await makeImage(800, 1600)]) {
    ids.push((await uploadPhoto(app, tk.admin!, prop.id, { buffer })).confirm!.json().id);
  }
  mediaIds = ids;
  await call('POST', `/properties/${prop.id}/publish`, 'admin');
});
afterEach(() => { calls.length = 0; fail = []; });
afterAll(async () => { vi.unstubAllGlobals(); await app.close(); await prisma.$disconnect(); });

describe('segurança do login', () => {
  it('um token sem usuário/empresa e o state do Facebook nunca autenticam', async () => {
    const jwt = app.get(JwtService);
    const admin = (await call('GET', '/auth/me', 'admin')).json();
    const noSub = await jwt.signAsync({ cid: admin.companyId }); // antes: o Prisma ignorava `id: undefined` e devolvia o 1º usuário
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${noSub}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${await jwt.signAsync({ sub: admin.id })}` } })).statusCode).toBe(401); // sem cid

    const state = new URL((await app.inject({ method: 'POST', url: '/api/v1/social/connect', headers: auth(tk.admin!) })).json().url).searchParams.get('state')!;
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${state}` } })).statusCode).toBe(401);
  });
});

describe('conexão com o Facebook', () => {
  it('sem META_APP_ID/SECRET o login é recusado com instrução; sem permissão também', async () => {
    const plain = await bootApp();
    try {
      const t = (await login(plain, 'admin.a@teste.com')).body.accessToken;
      const r = await plain.inject({ method: 'POST', url: '/api/v1/social/connect', headers: auth(t) });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe('SOCIAL_NOT_CONFIGURED');
      expect((await plain.inject({ method: 'GET', url: '/api/v1/social/accounts', headers: auth(t) })).json().configured).toBe(false);
    } finally { await plain.close(); }
    expect((await call('POST', '/social/connect', 'broker')).statusCode).toBe(403);
    expect((await call('POST', '/social/connect', 'manager')).statusCode).toBe(403); // gerente só visualiza marketing
  });

  it('cada empresa cadastra vários apps da Meta (segredo criptografado, nunca devolvido) e escolhe qual usar ao conectar; sem cadastro, cai no padrão do servidor', async () => {
    const plain = await bootApp({ API_PUBLIC_URL: 'https://api.teste.com.br', SITE_URL: 'https://site.teste.com.br', SOCIAL_POLL_MS: '1' });
    try {
      const a = (await login(plain, 'admin.a@teste.com')).body.accessToken;
      const b = (await login(plain, 'admin.b@teste.com')).body.accessToken;
      const req = (method: 'POST' | 'PATCH' | 'DELETE' | 'GET', url: string, t: string, payload?: unknown) => plain.inject({ method, url: `/api/v1${url}`, headers: auth(t), payload: payload as never });
      const okApp = { name: 'App Imobiliária', appId: '111222333', appSecret: 'segredo-empresa-a-0123456789' };

      // validações e permissão
      expect((await req('POST', '/social/apps', a, { ...okApp, appId: 'abc' })).statusCode).toBe(400);
      expect((await req('POST', '/social/apps', a, { ...okApp, name: '' })).statusCode).toBe(400);
      expect((await req('POST', '/social/apps', a, { name: 'Sem chave', appId: '111222333' })).statusCode).toBe(400);
      expect((await req('POST', '/social/apps', tk.broker!, okApp)).statusCode).toBe(403);

      // a Meta recusa o par → não salva
      fail = [{ match: /oauth\/access_token/, times: 1, status: 400, code: 101, message: 'Invalid app secret' }];
      const bad = await req('POST', '/social/apps', a, { ...okApp, appSecret: 'segredo-invalido-0123456789' });
      expect(bad.json().code).toBe('SOCIAL_APP_INVALID');
      expect((await req('GET', '/social/accounts', a)).json().configured).toBe(false);

      // salva o primeiro: segredo criptografado e não devolvido
      const one = await req('POST', '/social/apps', a, okApp);
      expect(one.statusCode).toBe(201);
      expect(one.json().apps).toMatchObject([{ name: 'App Imobiliária', appId: '111222333', source: 'company', accountCount: 0 }]);
      expect(JSON.stringify(one.json())).not.toContain('segredo-empresa-a');
      const row = await prisma.socialApp.findFirstOrThrow({ where: { appId: '111222333' } });
      expect(row.secrets).not.toContain('segredo-empresa-a');
      expect((await req('POST', '/social/apps', a, okApp)).json().code).toBe('SOCIAL_APP_DUPLICATE');

      // com um só app, conectar não exige escolha; a empresa B continua sem app
      const url1 = new URL((await req('POST', '/social/connect', a)).json().url);
      expect(url1.searchParams.get('client_id')).toBe('111222333');
      expect((await req('POST', '/social/connect', b)).json().code).toBe('SOCIAL_NOT_CONFIGURED');

      // segundo app: agora é preciso escolher
      const two = await req('POST', '/social/apps', a, { name: 'App Marketing', appId: '444555666', appSecret: 'segredo-marketing-0123456789' });
      const apps = two.json().apps as { id: string; name: string }[];
      expect(apps.map((x) => x.name)).toEqual(['App Imobiliária', 'App Marketing']);
      expect((await req('POST', '/social/connect', a)).json().code).toBe('SOCIAL_APP_REQUIRED');
      expect((await req('POST', '/social/connect', b, { appId: apps[0]!.id })).statusCode).toBe(400); // app de outra empresa
      expect((await req('POST', '/social/connect', a, { appId: '00000000-0000-4000-8000-000000000000' })).json().code).toBe('SOCIAL_APP_REQUIRED');

      // o login e a troca do código usam o app escolhido, e a conta guarda por qual app entrou
      const url2 = new URL((await req('POST', '/social/connect', a, { appId: apps[1]!.id })).json().url);
      expect(url2.searchParams.get('client_id')).toBe('444555666');
      calls.length = 0;
      const cb = await plain.inject({ method: 'GET', url: `/api/v1/social/oauth/callback?code=C1&state=${encodeURIComponent(url2.searchParams.get('state')!)}` });
      expect(cb.headers.location).toContain('status=connected');
      for (const e of graph(/GET oauth\/access_token/)) { expect(e.query.get('client_id')).toBe('444555666'); expect(e.query.get('client_secret')).toBe('segredo-marketing-0123456789'); }
      const listed = (await req('GET', '/social/accounts', a)).json();
      expect(listed.pending.every((x: { appName: string }) => x.appName === 'App Marketing')).toBe(true);
      expect(listed.apps.find((x: { name: string }) => x.name === 'App Marketing').accountCount).toBeGreaterThan(0);

      // editar (só o nome mantém a chave), trocar ID revalida, remover não apaga as contas
      const ren = await req('PATCH', `/social/apps/${apps[1]!.id}`, a, { name: 'Marketing 2' });
      expect(ren.json().apps.map((x: { name: string }) => x.name)).toContain('Marketing 2');
      expect((await req('PATCH', `/social/apps/${apps[1]!.id}`, b, { name: 'xx' })).statusCode).toBe(404);
      expect((await req('PATCH', `/social/apps/${apps[1]!.id}`, a, { appId: '111222333' })).json().code).toBe('SOCIAL_APP_DUPLICATE');
      expect((await req('DELETE', `/social/apps/${apps[1]!.id}`, b)).statusCode).toBe(404);
      expect((await req('DELETE', `/social/apps/${apps[1]!.id}`, a)).statusCode).toBe(204);
      const after = (await req('GET', '/social/accounts', a)).json();
      expect(after.apps).toHaveLength(1);
      expect(after.pending.length).toBeGreaterThan(0);
      expect(after.pending[0].appName).toBeNull();
      expect((await req('DELETE', `/social/apps/${apps[0]!.id}`, a)).statusCode).toBe(204); // deixa a empresa A sem app próprio para os demais testes
      await prisma.socialAccount.deleteMany({ where: { status: 'PENDING' } });
    } finally { await plain.close(); }

    // com env no servidor, a empresa B usa o padrão (app virtual "server")
    const withEnv = (await call('GET', '/social/accounts', 'adminB')).json();
    expect(withEnv.apps).toMatchObject([{ id: 'server', appId: '1234567890', source: 'server' }]);
  });

  it('monta a URL do diálogo com escopos e redirect, guarda as Páginas/Instagram como pendentes (token criptografado) e ativa só as escolhidas', async () => {
    const { url, cb } = await connectAccounts();
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toMatch(/\/dialog\/oauth$/);
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.teste.com.br/api/v1/social/oauth/callback');
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish');

    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`${ADMIN_URL}/redes-sociais?aba=contas&status=connected`);
    const exchange = graph(/GET oauth\/access_token/);
    expect(exchange).toHaveLength(2); // código → token curto → token longo
    expect(exchange[0]!.query.get('code')).toBe('CODE123');
    expect(exchange[1]!.query.get('fb_exchange_token')).toBe('SHORT-USER-TOKEN');
    expect(graph(/GET me\/accounts/)[0]!.auth).toBe('Bearer LONG-USER-TOKEN');

    const list = (await call('GET', '/social/accounts', 'marketing')).json();
    expect(list.accounts).toHaveLength(0);
    expect(list.pending.map((a: { provider: string; name: string }) => `${a.provider}:${a.name}`).sort()).toEqual(['FACEBOOK_PAGE:Atelier Imóveis', 'FACEBOOK_PAGE:Outra Página', 'INSTAGRAM:atelierimoveis']);
    expect(list.pending.find((a: { provider: string }) => a.provider === 'INSTAGRAM').linkedPageName).toBe('Atelier Imóveis');
    expect(JSON.stringify(list)).not.toContain('PAGE-TOKEN');
    const row = await prisma.socialAccount.findFirstOrThrow({ where: { externalId: 'PAGE1' } });
    expect(row.secrets).not.toContain('PAGE-TOKEN-1'); // criptografado em repouso

    fbId = list.pending.find((a: { externalId: string }) => a.externalId === 'PAGE1').id;
    igId = list.pending.find((a: { externalId: string }) => a.externalId === 'IG1').id;
    const other = list.pending.find((a: { externalId: string }) => a.externalId === 'PAGE2').id;
    expect((await call('POST', '/social/accounts/activate', 'marketing', { accountIds: [fbId, other, '00000000-0000-7000-8000-000000000000'] })).statusCode).toBe(400);
    const active = (await call('POST', '/social/accounts/activate', 'marketing', { accountIds: [fbId, igId] })).json();
    expect(active.accounts.map((a: { externalId: string }) => a.externalId).sort()).toEqual(['IG1', 'PAGE1']);
    expect(active.pending).toHaveLength(0); // a Página não escolhida foi descartada, junto com o token
    expect(await prisma.socialAccount.count({ where: { externalId: 'PAGE2' } })).toBe(0);
  });

  it('state inválido, adulterado, expirado ou de recusa nunca grava contas nem quebra a tela', async () => {
    const before = await prisma.socialAccount.count();
    const good = new URL((await app.inject({ method: 'POST', url: '/api/v1/social/connect', headers: auth(tk.marketing!) })).json().url).searchParams.get('state')!;
    const tampered = `${good.split('.')[0]}x.${good.split('.')[1]}`;
    const expiredBody = Buffer.from(JSON.stringify({ cid: 'x', uid: 'y', exp: Date.now() - 1000 })).toString('base64url');
    for (const state of ['lixo', tampered, `${expiredBody}.assinatura`, '']) {
      const r = await app.inject({ method: 'GET', url: `/api/v1/social/oauth/callback?code=C&state=${state}` });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toContain('status=error');
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/social/oauth/callback?code=C' })).headers.location).toContain('status=error');
    const denied = await app.inject({ method: 'GET', url: `/api/v1/social/oauth/callback?error=access_denied&state=${encodeURIComponent(good)}` });
    expect(denied.headers.location).toContain('status=denied');
    expect(graph(/oauth\/access_token/)).toHaveLength(0); // nada foi trocado com a Meta
    expect(await prisma.socialAccount.count()).toBe(before);

    fail = [{ match: /oauth\/access_token/, times: 1, code: 100, message: 'Invalid verification code' }];
    const s2 = new URL((await app.inject({ method: 'POST', url: '/api/v1/social/connect', headers: auth(tk.marketing!) })).json().url).searchParams.get('state')!;
    expect((await app.inject({ method: 'GET', url: `/api/v1/social/oauth/callback?code=BAD&state=${encodeURIComponent(s2)}` })).headers.location).toContain('status=error');
  });

  it('cada empresa vê só as suas contas', async () => {
    expect((await call('GET', '/social/accounts', 'adminB')).json()).toMatchObject({ accounts: [], pending: [] });
    expect((await call('DELETE', `/social/accounts/${fbId}`, 'adminB')).statusCode).toBe(404);
    expect((await call('POST', `/social/accounts/${fbId}/check`, 'adminB')).statusCode).toBe(404);
    expect((await call('POST', '/social/accounts/activate', 'adminB', { accountIds: [fbId] })).statusCode).toBe(400);
  });
});

describe('composição', () => {
  it('abre a postagem pronta: fotos do imóvel (capa primeiro) e texto padrão com a descrição, preço, local e link', async () => {
    const c = (await call('GET', `/social/composer/${prop.id}`, 'marketing')).json();
    expect(c.property).toMatchObject({ id: prop.id, code: prop.code, published: true });
    expect(c.media).toHaveLength(3);
    expect(c.media[0].isCover).toBe(true);
    expect(c.media.every((m: { thumbnailUrl: string }) => !!m.thumbnailUrl)).toBe(true);
    expect(c.caption).toContain('Casa com piscina em condomínio');
    expect(c.caption).toContain('📍 Swiss Park, Campinas');
    expect(c.caption).toMatch(/R\$\s?1\.450\.000/);
    expect(c.caption).toContain('4 dorm. · 3 suítes · 4 vagas · 310 m²');
    expect(c.caption).toContain('Casa térrea de arquitetura contemporânea'); // a descrição vem como padrão
    expect(c.caption).toContain(`https://site.teste.com.br/imovel/${prop.slug}`);
    expect(c.caption).toContain(`Cód. ${prop.code}`);
    expect(c.caption.length).toBeLessThanOrEqual(2200); // cabe no Instagram
    expect((await call('GET', `/social/composer/${prop.id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('GET', `/social/composer/${prop.id}`, 'manager')).statusCode).toBe(403);
  });

  it('descrições longas são cortadas no fim de uma frase para caber nos 2.200 caracteres', async () => {
    const long = (await call('POST', '/properties', 'admin', { title: 'Imóvel com descrição enorme', purpose: 'SALE', typeId, salePrice: 1, city: 'X', neighborhood: 'Y', description: `${'Uma frase completa sobre o imóvel. '.repeat(200)}` })).json();
    const c = (await call('GET', `/social/composer/${long.id}`, 'marketing')).json();
    expect(c.caption.length).toBeLessThanOrEqual(2000);
    expect(c.caption).toContain('…');
  });
});

describe('validações ao criar', () => {
  it('recusa fotos de outro imóvel, contas inválidas, texto longo demais para o Instagram, datas inválidas e falta de permissão', async () => {
    const other = (await call('POST', '/properties', 'admin', { title: 'Outro imóvel', purpose: 'SALE', typeId, salePrice: 1, city: 'X', neighborhood: 'Y' })).json();
    const otherMedia = (await uploadPhoto(app, tk.admin!, other.id)).confirm!.json().id;
    const base = { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Texto', accountIds: [fbId], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() };
    const post = (over: object, who = 'marketing') => call('POST', '/social/posts', who, { ...base, ...over });

    expect((await post({ mediaIds: [otherMedia] })).json().code).toBe('SOCIAL_MEDIA_INVALID');
    expect((await post({ mediaIds: [] })).statusCode).toBe(400);
    expect((await post({ mediaIds: Array(11).fill(mediaIds[0]) })).statusCode).toBe(400);
    expect((await post({ accountIds: ['00000000-0000-7000-8000-000000000000'] })).json().code).toBe('SOCIAL_ACCOUNT_INVALID');
    expect((await post({ accountIds: [igId], caption: 'a'.repeat(2201) })).json().code).toBe('SOCIAL_INSTAGRAM_CAPTION');
    expect((await post({ accountIds: [fbId], caption: 'a'.repeat(2201) })).statusCode).toBe(201); // o Facebook aceita
    expect((await post({ scheduledAt: new Date(Date.now() - 3_600_000).toISOString() })).json().code).toBe('SOCIAL_SCHEDULE_INVALID');
    expect((await post({ scheduledAt: new Date(Date.now() + 400 * 86_400_000).toISOString() })).json().code).toBe('SOCIAL_SCHEDULE_INVALID');
    expect((await post({}, 'broker')).statusCode).toBe(403);
    expect((await post({}, 'manager')).statusCode).toBe(403);
    expect((await post({}, 'adminB')).statusCode).toBe(404); // imóvel de outra empresa
    await prisma.socialPost.deleteMany();
  });
});

describe('agendar e publicar', () => {
  it('não publica antes da hora; na hora publica no Facebook (1 foto) e no Instagram (carrossel) com JPEG dentro das proporções aceitas', async () => {
    const created = await call('POST', '/social/posts', 'marketing', {
      propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Casa dos sonhos 🏡', accountIds: [fbId], scheduledAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    expect(created.statusCode).toBe(201);
    const fbPost = created.json();
    expect(fbPost).toMatchObject({ status: 'SCHEDULED', caption: 'Casa dos sonhos 🏡' });
    expect(fbPost.targets).toHaveLength(1);

    const car = (await call('POST', '/social/posts', 'marketing', {
      propertyId: prop.id, mediaIds, caption: 'Carrossel completo', accountIds: [igId], scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    })).json();

    expect(await tick()).toBe(0); // ainda não venceu
    expect(graph(/POST/)).toHaveLength(0);
    await prisma.socialPost.updateMany({ data: { scheduledAt: new Date(Date.now() - 1000) } }); // "passa o tempo"
    expect(await tick()).toBe(2);

    // Facebook: 1 foto → /photos com a URL JPEG e o texto
    const fb = graph(/POST PAGE1\/photos/);
    expect(fb).toHaveLength(1);
    expect(fb[0]!.auth).toBe('Bearer PAGE-TOKEN-1');
    expect(fb[0]!.body).toMatchObject({ caption: 'Casa dos sonhos 🏡', published: true });
    expect(fb[0]!.body.url).toMatch(/\/social\/[0-9a-f-]+\.jpg$/);

    // Instagram: 3 fotos → 3 itens de carrossel + contêiner do carrossel + publicação
    const items = graph(/POST IG1\/media$/);
    expect(items).toHaveLength(4);
    expect(items.slice(0, 3).every((c) => c.body.is_carousel_item === true && /\.jpg$/.test(c.body.image_url))).toBe(true);
    expect(items[3]!.body).toMatchObject({ media_type: 'CAROUSEL', caption: 'Carrossel completo' });
    expect(items[3]!.body.children.split(',')).toHaveLength(3);
    const creationId = graph(/POST IG1\/media_publish/)[0]!.body.creation_id as string;
    expect(creationId).toMatch(/^container-\d+$/);
    expect(items[3]!.body.children.split(',')).not.toContain(creationId); // publica o contêiner do carrossel, não um item

    // Cada foto foi convertida para JPEG, com no máximo 1440px e proporção aceita pelo Instagram (4:5 a 1,91:1)
    for (const c of items.slice(0, 3)) {
      const file = await app.inject({ method: 'GET', url: new URL(c.body.image_url).pathname });
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toBe('image/jpeg');
      const meta = await sharp(file.rawPayload).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width!).toBeLessThanOrEqual(1440);
      const ratio = meta.width! / meta.height!;
      expect(ratio).toBeGreaterThanOrEqual(0.79);
      expect(ratio).toBeLessThanOrEqual(1.92);
    }

    const done = (await call('GET', `/social/posts/${car.id}`, 'marketing')).json();
    expect(done).toMatchObject({ status: 'PUBLISHED' });
    expect(done.publishedAt).toBeTruthy();
    expect(done.targets[0]).toMatchObject({ status: 'PUBLISHED', attempts: 1, error: null });
    expect(done.targets[0].permalink).toMatch(/^https:\/\/instagram\.com\/p\/igmedia-/);
    expect((await call('GET', `/social/posts/${fbPost.id}`, 'marketing')).json().targets[0].permalink).toMatch(/^https:\/\/facebook\.com\/PAGE1_post/);

    // histórico do imóvel e auditoria
    const history = (await call('GET', `/properties/${prop.id}/history`, 'admin')).json();
    expect(history.filter((h: { action: string }) => h.action === 'SOCIAL_PUBLISHED')).toHaveLength(2);
    expect((await call('GET', '/audit-logs?entity=SOCIAL_POST', 'admin')).json().items.some((a: { action: string }) => a.action === 'SCHEDULE')).toBe(true);
    // a segunda publicação reaproveita os JPEGs já gerados
    expect(await prisma.propertyMedia.count({ where: { propertyId: prop.id, socialKey: { not: null } } })).toBe(3);
  });

  it('várias fotos no Facebook: envia cada uma sem publicar e cria um post único com todas anexadas', async () => {
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0], mediaIds[2]], caption: 'Duas fotos', accountIds: [fbId] })).json(); // sem data = agora
    expect(p.status).toBe('SCHEDULED'); // o testes chamam tick() na mão
    await tick();
    const photos = graph(/POST PAGE1\/photos/);
    expect(photos).toHaveLength(2);
    expect(photos.every((c) => c.body.published === false)).toBe(true);
    const feed = graph(/POST PAGE1\/feed/)[0]!;
    expect(feed.body.message).toBe('Duas fotos');
    expect(feed.body.attached_media).toHaveLength(2);
    expect(feed.body.attached_media[0]).toHaveProperty('media_fbid');
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('PUBLISHED');
  });

  it('edita, publica agora e cancela enquanto agendada; depois de publicada não muda mais', async () => {
    const future = () => new Date(Date.now() + 5 * 3_600_000).toISOString();
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Rascunho', accountIds: [fbId], scheduledAt: future() })).json();
    const upd = (await call('PATCH', `/social/posts/${p.id}`, 'marketing', { caption: 'Texto revisado', mediaIds: [mediaIds[0], mediaIds[2]], accountIds: [fbId, igId], scheduledAt: future() })).json();
    expect(upd).toMatchObject({ caption: 'Texto revisado' });
    expect(upd.media).toHaveLength(2);
    expect(upd.targets.map((t: { provider: string }) => t.provider).sort()).toEqual(['FACEBOOK_PAGE', 'INSTAGRAM']);
    expect((await call('PATCH', `/social/posts/${p.id}`, 'marketing', { caption: 'a'.repeat(2201) })).json().code).toBe('SOCIAL_INSTAGRAM_CAPTION');

    const c = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Vai ser cancelada', accountIds: [fbId], scheduledAt: future() })).json();
    expect((await call('POST', `/social/posts/${c.id}/cancel`, 'marketing')).json().status).toBe('CANCELLED');
    await tick();
    expect(graph(/POST/).some((g) => g.body?.caption === 'Vai ser cancelada')).toBe(false);
    expect((await call('POST', `/social/posts/${c.id}/publish-now`, 'marketing')).json().code).toBe('SOCIAL_POST_LOCKED');

    calls.length = 0;
    expect((await call('POST', `/social/posts/${p.id}/publish-now`, 'marketing')).json().status).toBe('SCHEDULED');
    await tick();
    const done = (await call('GET', `/social/posts/${p.id}`, 'marketing')).json();
    expect(done.status).toBe('PUBLISHED');
    expect((await call('PATCH', `/social/posts/${p.id}`, 'marketing', { caption: 'tarde demais' })).json().code).toBe('SOCIAL_POST_LOCKED');
    expect((await call('POST', `/social/posts/${p.id}/cancel`, 'marketing')).json().code).toBe('SOCIAL_POST_LOCKED');
  });
});

describe('falhas e novas tentativas', () => {
  it('cada rede falha sozinha: Facebook publica, Instagram recusa (erro definitivo) → "publicada em parte"; reenviar só o que falhou', async () => {
    fail = [{ match: /POST IG1\/media$/, times: 1, code: 9004, message: 'Falha ao baixar a imagem' }];
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Parcial', accountIds: [fbId, igId] })).json();
    await tick();
    const cur = (await call('GET', `/social/posts/${p.id}`, 'marketing')).json();
    expect(cur.status).toBe('PARTIAL');
    const ig = cur.targets.find((t: { provider: string }) => t.provider === 'INSTAGRAM');
    const fb = cur.targets.find((t: { provider: string }) => t.provider === 'FACEBOOK_PAGE');
    expect(fb.status).toBe('PUBLISHED');
    expect(ig).toMatchObject({ status: 'FAILED', retryable: false, attempts: 1 });
    expect(ig.error).toContain('Falha ao baixar a imagem');

    expect((await call('POST', `/social/posts/${p.id}/targets/${fb.id}/retry`, 'marketing')).json().code).toBe('SOCIAL_TARGET_NOT_RETRYABLE'); // já publicou
    calls.length = 0;
    expect((await call('POST', `/social/posts/${p.id}/targets/${ig.id}/retry`, 'marketing')).json().status).toBe('SCHEDULED');
    await tick();
    expect(graph(/POST PAGE1\/photos/)).toHaveLength(0); // o Facebook não é republicado
    expect(graph(/POST IG1\/media_publish/)).toHaveLength(1);
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('PUBLISHED');
  });

  it('erro temporário da Meta: tenta de novo com espera crescente e desiste após 3 tentativas', async () => {
    fail = [{ match: /POST PAGE1\/photos/, times: 99, code: 2, status: 500, message: 'Serviço temporariamente indisponível' }];
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Instável', accountIds: [fbId] })).json();
    const target = async () => (await prisma.socialPostTarget.findFirstOrThrow({ where: { postId: p.id } }));

    await tick();
    let t = await target();
    expect(t).toMatchObject({ status: 'PENDING', attempts: 1, retryable: true });
    expect(t.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000); // ~1 min
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('PUBLISHING');
    calls.length = 0;
    expect(await tick()).toBe(0); // ainda não é hora da 2ª tentativa
    expect(calls).toHaveLength(0);

    await prisma.socialPostTarget.update({ where: { id: t.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await tick();
    t = await target();
    expect(t).toMatchObject({ status: 'PENDING', attempts: 2 });
    expect(t.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 200_000); // ~5 min

    await prisma.socialPostTarget.update({ where: { id: t.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await tick();
    t = await target();
    expect(t).toMatchObject({ status: 'FAILED', attempts: 3, retryable: false });
    expect(t.error).toContain('indisponível');
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('FAILED');

    fail = [];
    calls.length = 0;
    await call('POST', `/social/posts/${p.id}/targets/${t.id}/retry`, 'marketing');
    await tick();
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('PUBLISHED'); // reenvio manual recomeça as tentativas
  });

  it('token expirado (erro 190): a conta é marcada como expirada, sem novas tentativas, e o aviso pede para reconectar', async () => {
    fail = [{ match: /POST PAGE1\/photos/, times: 99, code: 190, status: 401, message: 'Error validating access token' }];
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Token vencido', accountIds: [fbId] })).json();
    await tick();
    const cur = (await call('GET', `/social/posts/${p.id}`, 'marketing')).json();
    expect(cur.status).toBe('FAILED');
    expect(cur.targets[0]).toMatchObject({ status: 'FAILED', retryable: false, attempts: 1 });
    expect(cur.targets[0].error).toMatch(/Reconecte/);
    expect((await call('GET', '/social/accounts', 'marketing')).json().accounts.find((a: { id: string }) => a.id === fbId).status).toBe('EXPIRED');
    // conta expirada não pode receber novas publicações
    expect((await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'x', accountIds: [fbId] })).json().code).toBe('SOCIAL_ACCOUNT_INVALID');

    // reconectar renova o token e reativa a conta
    fail = [];
    await connectAccounts();
    const list = (await call('GET', '/social/accounts', 'marketing')).json();
    expect(list.accounts.find((a: { id: string }) => a.id === fbId).status).toBe('ACTIVE');
    expect(list.pending.map((a: { externalId: string }) => a.externalId)).toEqual(['PAGE2']); // só a Página nova aguarda escolha
    await call('POST', '/social/accounts/activate', 'marketing', { accountIds: [fbId, igId] });
  });
});

describe('concorrência e isolamento', () => {
  it('duas instâncias da API no mesmo banco nunca publicam a mesma postagem duas vezes', async () => {
    const second = await bootApp(SOCIAL_ENV);
    try {
      const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Sem duplicar', accountIds: [fbId] })).json();
      const [a, b] = await Promise.all([app.get(SocialPublisher).tick(), second.get(SocialPublisher).tick()]);
      expect(a + b).toBe(1); // só uma instância reservou a publicação
      expect(graph(/POST PAGE1\/photos/).filter((c) => c.body.caption === 'Sem duplicar')).toHaveLength(1);
      expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('PUBLISHED');
    } finally { await second.close(); }
  });

  it('recupera publicações "travadas" (instância caiu no meio) depois de 10 minutos', async () => {
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Recuperada', accountIds: [fbId] })).json();
    await prisma.socialPost.update({ where: { id: p.id }, data: { status: 'PUBLISHING', lockedAt: new Date(Date.now() - 60_000) } }); // travada há 1 min: ainda em andamento
    expect(await tick()).toBe(0);
    await prisma.socialPost.update({ where: { id: p.id }, data: { lockedAt: new Date(Date.now() - 11 * 60_000) } }); // travada há 11 min
    expect(await tick()).toBe(1);
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('PUBLISHED');
  });

  it('a outra empresa não vê, edita, cancela nem reenvia nada; gerente só visualiza', async () => {
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Da empresa A', accountIds: [fbId], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })).json();
    expect((await call('GET', '/social/posts', 'adminB')).json().total).toBe(0);
    for (const [m, u, b] of [['GET', `/social/posts/${p.id}`, undefined], ['PATCH', `/social/posts/${p.id}`, { caption: 'invasão' }], ['POST', `/social/posts/${p.id}/cancel`, undefined], ['POST', `/social/posts/${p.id}/publish-now`, undefined]] as const) {
      expect((await call(m, u, 'adminB', b)).statusCode, `${m} ${u}`).toBe(404);
    }
    expect((await call('GET', '/social/posts', 'manager')).statusCode).toBe(200);
    expect((await call('POST', `/social/posts/${p.id}/cancel`, 'manager')).statusCode).toBe(403);
    expect((await call('GET', '/social/posts', 'broker')).statusCode).toBe(403);
    const list = (await call('GET', '/social/posts?view=scheduled', 'marketing')).json();
    expect(list.items.some((i: { id: string }) => i.id === p.id)).toBe(true);
    expect((await call('GET', '/social/posts?view=published', 'marketing')).json().items.every((i: { status: string }) => ['PUBLISHED', 'PARTIAL'].includes(i.status))).toBe(true);
  });

  it('desconectar uma conta cancela as publicações agendadas que só dependiam dela; "checar" detecta token vencido', async () => {
    const p = (await call('POST', '/social/posts', 'marketing', { propertyId: prop.id, mediaIds: [mediaIds[0]], caption: 'Só no Instagram', accountIds: [igId], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })).json();
    fail = [{ match: /GET PAGE1$/, times: 1, code: 190, status: 401, message: 'Session has expired' }];
    expect((await call('POST', `/social/accounts/${igId}/check`, 'marketing')).json()).toMatchObject({ ok: false, status: 'EXPIRED' });
    expect((await call('POST', `/social/accounts/${igId}/check`, 'marketing')).json()).toMatchObject({ ok: true, status: 'ACTIVE' }); // a Meta voltou a aceitar
    expect((await call('DELETE', `/social/accounts/${igId}`, 'marketing')).statusCode).toBe(204);
    expect((await call('GET', `/social/posts/${p.id}`, 'marketing')).json().status).toBe('CANCELLED');
    expect(await prisma.socialAccount.count({ where: { externalId: 'IG1' } })).toBe(0);
    const audit = (await call('GET', '/audit-logs?entity=SOCIAL_ACCOUNT', 'admin')).json().items.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['CONNECT', 'ACTIVATE', 'DISCONNECT']));
    expect(JSON.stringify((await call('GET', '/audit-logs?pageSize=100', 'admin')).json())).not.toContain('PAGE-TOKEN');
  });
});
