import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { findImage } from '../src/ai/providers/gemini.provider';
import { LocalProvider } from '../src/ai/providers/local.provider';
import { OpenAiProvider } from '../src/ai/providers/openai.provider';
import { PROMPTS } from '../src/ai/providers/prompts';
import { StorageService } from '../src/storage/storage.service';
import { auth, bootApp, login, resetAndSeed, uploadPhoto } from './helpers';

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
let typeId: string;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');
let storage: StorageService;

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });

// ---------- Provedores simulados ----------
interface Seen { url: string; headers: Record<string, string>; body: any; form?: FormData }
const seen: Seen[] = [];
let mode: 'ok' | 'http500' | 'http429' | 'safety' | 'noimage' | 'badkey' = 'ok';
let generated: Buffer;
const GOOD = 'GOOD-KEY-1234567890';
const fetchStub = vi.fn(async (input: any, init: any = {}) => {
  const url = String(input);
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  const key = headers['x-goog-api-key'] ?? headers.authorization?.replace('Bearer ', '');
  if (/\/models/.test(url)) return key === GOOD ? json({ models: [] }) : json({ error: { message: 'bad key' } }, 401);
  if (!/\/interactions$|\/images\/edits$/.test(url)) return json({ error: { message: `sem rota: ${url}` } }, 500);
  seen.push({ url, headers, body: typeof init.body === 'string' ? JSON.parse(init.body) : null, form: init.body instanceof FormData ? init.body : undefined });
  if (key !== GOOD || mode === 'badkey') return json({ error: { message: 'API key not valid' } }, 401);
  if (mode === 'http500') return json({ error: { message: 'boom' } }, 500);
  if (mode === 'http429') return json({ error: { message: 'quota' } }, 429);
  if (mode === 'safety') return json({ error: { message: 'Blocked by safety policy' } }, 400);
  if (mode === 'noimage') return json({ output_text: 'Não posso fazer isso.' });
  const b64 = generated.toString('base64');
  return /interactions/.test(url) ? json({ id: 'i1', output_image: { data: b64, mime_type: 'image/png' } }) : json({ data: [{ b64_json: b64 }] });
});

const solid = (w: number, h: number, c: [number, number, number], fmt: 'png' | 'jpeg' = 'png') =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } })[fmt]().toBuffer();
const pixel = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
const near = (a: number[], b: number[], tol = 12) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

let prop: { id: string; slug: string };
async function newPhoto(color: [number, number, number] = [200, 160, 90]) {
  const r = await uploadPhoto(app, tk.admin!, prop.id, { buffer: await solid(1200, 800, color) });
  const id = r.confirm!.json().id as string;
  return { id, row: () => prisma.propertyMedia.findUniqueOrThrow({ where: { id } }) };
}
const configure = (body: object, who = 'admin') => call('PUT', '/ai/settings', who, body);

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await resetAndSeed();
  app = await bootApp();
  storage = app.get(StorageService);
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  await call('POST', '/users', 'admin', { name: 'Editor Fotos', email: 'fotos@teste.com', roleKey: 'MARKETING', password: 'Senha@12345' });
  tk.marketing = (await login(app, 'fotos@teste.com')).body.accessToken;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
  generated = await solid(1024, 768, [30, 60, 200]);
  prop = (await call('POST', '/properties', 'admin', { title: 'Casa para IA', purpose: 'SALE', typeId, salePrice: 900000, city: 'Campinas', neighborhood: 'Cambuí' })).json();
});
afterEach(() => { seen.length = 0; mode = 'ok'; });
afterAll(async () => { vi.unstubAllGlobals(); await app.close(); await prisma.$disconnect(); });

describe('provedores de IA (abstração)', () => {
  it('lê a imagem em qualquer formato de resposta do Gemini e ignora resposta sem imagem', () => {
    const b64 = 'A'.repeat(400);
    expect(findImage({ output_image: { data: b64, mime_type: 'image/png' } })).toBe(b64);
    expect(findImage({ outputs: [{ type: 'text', text: 'oi' }, { type: 'image', data: b64, mime_type: 'image/jpeg' }] })).toBe(b64);
    expect(findImage({ candidates: [{ content: { parts: [{ text: 'x' }, { inlineData: { mimeType: 'image/png', data: b64 } }] } }] })).toBe(b64);
    expect(findImage({ output_text: 'sem imagem', data: 'curto' })).toBeNull();
  });

  it('escolhe o tamanho do OpenAI pela proporção; toda instrução protege a estrutura do imóvel', () => {
    expect([OpenAiProvider.size(1200, 800), OpenAiProvider.size(800, 1200), OpenAiProvider.size(1000, 1000)]).toEqual(['1536x1024', '1024x1536', '1024x1024']);
    for (const p of [PROMPTS.enhance(), PROMPTS.lighting(), PROMPTS.removeObject('um carro'), PROMPTS.removeFurniture(), PROMPTS.virtualStage('modern'), PROMPTS.replaceSky()]) {
      expect(p).toContain('Do not add or remove structural elements');
      expect(p).toContain('photorealistic');
    }
    expect(PROMPTS.removeObject('um carro azul')).toContain('um carro azul');
  });

  it('o modo local melhora foto e iluminação sem custo e recusa o que exige IA generativa', async () => {
    const local = new LocalProvider();
    expect([local.supports('ENHANCE'), local.supports('LIGHTING'), local.supports('VIRTUAL_STAGE'), local.supports('REMOVE_OBJECT')]).toEqual([true, true, false, false]);
    // gradiente escuro (uma imagem lisa não tem o que reequilibrar)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><defs><linearGradient id="g"><stop offset="0" stop-color="#1e1e1e"/><stop offset="1" stop-color="#787878"/></linearGradient></defs><rect width="200" height="150" fill="url(#g)"/></svg>';
    const dark = await sharp(Buffer.from(svg)).png().toBuffer();
    const mean = async (b: Buffer) => (await sharp(b).stats()).channels[0]!.mean;
    const lit = await local.improveLighting({ image: dark, mimeType: 'image/png', width: 200, height: 150 });
    expect(lit.costUsd).toBe(0);
    expect(await mean(lit.image)).toBeGreaterThan(await mean(dark)); // clareou
    await expect(local.virtualStage({ image: dark, mimeType: 'image/png', width: 200, height: 150 })).rejects.toThrow(/provedor de IA/);
  });
});

describe('configuração do provedor', () => {
  it('começa no modo básico; só quem administra a empresa configura; a chave é validada, criptografada e nunca devolvida', async () => {
    const d = (await call('GET', '/ai/settings', 'admin')).json();
    expect(d).toMatchObject({ provider: 'local', keySet: true, monthlyLimit: 100, usage: { generations: 0, cost: 0 } });
    expect((await call('GET', '/ai/settings', 'marketing')).statusCode).toBe(403);
    expect((await configure({ provider: 'gemini', apiKey: GOOD }, 'marketing')).statusCode).toBe(403);
    expect((await call('GET', '/ai/status', 'marketing')).statusCode).toBe(200); // quem edita vê o que está disponível
    expect((await call('GET', '/ai/status', 'broker')).statusCode).toBe(403);

    expect((await configure({ provider: 'gemini' })).statusCode).toBe(400); // falta a chave
    const bad = await configure({ provider: 'gemini', apiKey: 'CHAVE-ERRADA-123456' });
    expect(bad.json().code).toBe('AI_KEY_INVALID');
    expect((await call('GET', '/ai/settings', 'admin')).json().provider).toBe('local'); // recusada não grava

    const ok = await configure({ provider: 'gemini', apiKey: GOOD, monthlyLimit: 5 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-image', keySet: true, monthlyLimit: 5 });
    expect(JSON.stringify(ok.json())).not.toContain(GOOD);
    const row = await prisma.integration.findFirstOrThrow({ where: { provider: 'AI_IMAGE' } });
    expect(row.secrets).not.toContain(GOOD);

    // voltar ao básico e depois ao Gemini reaproveita a chave já salva
    expect((await configure({ provider: 'local' })).json().provider).toBe('local');
    expect((await configure({ provider: 'gemini' })).json()).toMatchObject({ provider: 'gemini', keySet: true });
    expect((await call('GET', '/ai/settings', 'adminB')).json().provider).toBe('local'); // cada empresa tem a sua
    await configure({ provider: 'local' });
  });
});

describe('versões por IA: original preservado, aprovação e reversão', () => {
  it('modo local: melhora a foto como nova versão sem tocar no original; operações generativas pedem provedor; permissões e multiempresa', async () => {
    const m = await newPhoto();
    const before = await m.row();
    const originalBytes = await storage.read(before.originalKey);

    expect((await call('POST', `/media/${m.id}/generations`, 'broker', { operation: 'ENHANCE' })).statusCode).toBe(403);
    expect((await call('POST', `/media/${m.id}/generations`, 'adminB', { operation: 'ENHANCE' })).statusCode).toBe(404);
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'REMOVE_FURNITURE' })).json().code).toBe('AI_OPERATION_UNSUPPORTED');
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'NADA' })).statusCode).toBe(400);

    const r = await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE' });
    expect(r.statusCode).toBe(201);
    const g = r.json().generations[0];
    expect(g).toMatchObject({ operation: 'ENHANCE', status: 'READY', provider: 'local', cost: 0, active: false, parentId: null });
    expect(g.outputUrl).toBeTruthy();

    expect(Buffer.compare(await storage.read(before.originalKey), originalBytes)).toBe(0); // original intacto
    const after = await m.row();
    expect(after).toMatchObject({ aiModified: false, activeGenerationId: null, processedKey: before.processedKey }); // nada muda até aprovar
    expect((await call('GET', `/media/${m.id}/versions`, 'broker')).statusCode).toBe(200); // ver o histórico só exige ver mídias
    expect((await call('GET', `/media/${m.id}/versions`, 'adminB')).statusCode).toBe(404);
  });

  it('com Gemini: manda a foto e a instrução, registra custo, aprova para publicar, mostra o aviso no site e volta ao original', async () => {
    await configure({ provider: 'gemini', apiKey: GOOD });
    const m = await newPhoto([200, 160, 90]);
    const orig = await m.row();
    const originalBytes = await storage.read(orig.originalKey);

    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'REMOVE_OBJECT' })).json().code).toBe('AI_PROMPT_REQUIRED');
    const r = await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'REMOVE_OBJECT', prompt: 'o carro vermelho na garagem' });
    expect(r.statusCode).toBe(201);
    const g = r.json().generations[0];
    expect(g).toMatchObject({ status: 'READY', provider: 'gemini', model: 'gemini-3.1-flash-image', cost: 0.04, prompt: 'o carro vermelho na garagem' });

    // o que foi enviado ao provedor
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers['x-goog-api-key']).toBe(GOOD);
    expect(seen[0]!.url).toMatch(/\/interactions$/);
    expect(seen[0]!.body.model).toBe('gemini-3.1-flash-image');
    expect(seen[0]!.body.input[0].text).toContain('o carro vermelho na garagem');
    expect(seen[0]!.body.input[1]).toMatchObject({ type: 'image', mime_type: 'image/jpeg' });
    expect(seen[0]!.body.input[1].data.length).toBeGreaterThan(100);

    // a proporção da foto (3:2) foi mantida mesmo o provedor devolvendo 4:3
    const out = await storage.read((await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: g.id } })).outputKey!);
    const meta = await sharp(out).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(1.5, 1);
    expect(near(await pixel(out, 50, 50), [30, 60, 200], 20)).toBe(true);

    // ainda não aprovada: publicada continua a original
    expect((await m.row()).aiModified).toBe(false);
    const processedBefore = await storage.read((await m.row()).processedKey!);
    expect(near(await pixel(processedBefore, 50, 50), [200, 160, 90], 14)).toBe(true);

    // aprovar publica a versão de IA (nova chave = sem cache), sem apagar o original
    const ap = await call('POST', `/generations/${g.id}/approve`, 'marketing');
    expect(ap.statusCode).toBe(200);
    expect(ap.json()).toMatchObject({ activeGenerationId: g.id });
    const approved = await m.row();
    expect(approved).toMatchObject({ aiModified: true, activeGenerationId: g.id, renderedGenerationId: g.id });
    expect(approved.processedKey).not.toBe(orig.processedKey);
    const processedAfter = await storage.read(approved.processedKey!);
    expect(near(await pixel(processedAfter, 50, 50), [30, 60, 200], 20)).toBe(true);
    expect(Buffer.compare(await storage.read(orig.originalKey), originalBytes)).toBe(0);
    expect(await storage.head(orig.processedKey!)).toBeNull(); // arquivo da versão anterior saiu

    // o site avisa que a foto foi editada
    await call('POST', `/properties/${prop.id}/publish`, 'admin');
    const pub = await app.inject({ method: 'GET', url: `/api/v1/public/properties/${prop.slug}` });
    expect(pub.json().media.find((x: { id: string }) => x.id === m.id).aiModified).toBe(true);

    // voltar ao original
    const rv = await call('POST', `/media/${m.id}/revert`, 'marketing');
    expect(rv.json().activeGenerationId).toBeNull();
    expect((await m.row())).toMatchObject({ aiModified: false, activeGenerationId: null, renderedGenerationId: null });
    expect(near(await pixel(await storage.read((await m.row()).processedKey!), 50, 50), [200, 160, 90], 14)).toBe(true);
    expect(rv.json().generations).toHaveLength(1); // o histórico continua
  });

  it('encadeia versões (geração 2 parte da geração 1), não deixa duas edições ao mesmo tempo e só descarta versões livres', async () => {
    await configure({ provider: 'gemini', apiKey: GOOD });
    const m = await newPhoto();
    const g1 = (await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'LIGHTING' })).json().generations[0];
    const firstInput = seen[0]!.body.input[1].data as string;
    const g2 = (await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE', parentId: g1.id })).json().generations.find((g: { parentId: string }) => g.parentId === g1.id);
    expect(g2).toMatchObject({ status: 'READY', parentId: g1.id });
    expect(seen[1]!.body.input[1].data).not.toBe(firstInput); // a segunda edição partiu da imagem gerada, não do original
    const out1 = await sharp(Buffer.from(seen[1]!.body.input[1].data, 'base64')).raw().toBuffer({ resolveWithObject: true });
    expect(out1.data[0]! < 80 && out1.data[2]! > 150).toBe(true); // era azul (a saída da geração 1)

    // versão-pai e versão publicada não podem ser descartadas
    expect((await call('DELETE', `/generations/${g1.id}`, 'marketing')).json().code).toBe('AI_GENERATION_IN_USE');
    await call('POST', `/generations/${g2.id}/approve`, 'marketing');
    expect((await call('DELETE', `/generations/${g2.id}`, 'marketing')).json().code).toBe('AI_GENERATION_IN_USE');
    expect((await call('POST', `/generations/${g2.id}/approve`, 'adminB')).statusCode).toBe(404);
    await call('POST', `/media/${m.id}/revert`, 'marketing');
    const outKey = (await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: g2.id } })).outputKey!;
    expect((await call('DELETE', `/generations/${g2.id}`, 'marketing')).statusCode).toBe(200); // folha e sem uso: pode
    expect(await storage.head(outKey)).toBeNull();

    // parentId inexistente / de outra foto
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE', parentId: '00000000-0000-7000-8000-000000000000' })).json().code).toBe('AI_GENERATION_NOT_READY');

    // edição em andamento bloqueia outra na mesma foto
    await prisma.mediaGeneration.create({ data: { companyId: (await prisma.propertyMedia.findUniqueOrThrow({ where: { id: m.id } })).companyId, propertyId: prop.id, mediaId: m.id, operation: 'ENHANCE', provider: 'gemini', inputKey: 'x', status: 'PROCESSING' } });
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE' })).json().code).toBe('AI_GENERATION_BUSY');
    await prisma.mediaGeneration.updateMany({ where: { mediaId: m.id, status: 'PROCESSING' }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE' })).statusCode).toBe(201); // a travada antiga é dada como perdida
  });

  it('falhas do provedor viram mensagem clara, não custam nada e não travam a foto', async () => {
    await configure({ provider: 'gemini', apiKey: GOOD });
    const m = await newPhoto();
    const usage0 = (await call('GET', '/ai/settings', 'admin')).json().usage;
    const attempt = async (md: typeof mode) => { mode = md; return (await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE' })).json().generations.at(-1); };
    const cases: [typeof mode, RegExp][] = [['http500', /instável/], ['http429', /limite/], ['safety', /política/], ['noimage', /não devolveu uma imagem/], ['badkey', /recusou a chave/]];
    for (const [md, re] of cases) {
      const g = await attempt(md);
      expect(g).toMatchObject({ status: 'FAILED', cost: 0 });
      expect(g.error).toMatch(re);
    }
    expect((await call('GET', '/ai/settings', 'admin')).json().usage).toEqual(usage0); // falha não conta no consumo
    expect((await m.row())).toMatchObject({ aiModified: false, status: 'READY' });
    // versão que falhou pode ser descartada e não pode ser aprovada
    const failed = (await call('GET', `/media/${m.id}/versions`, 'marketing')).json().generations[0];
    expect((await call('POST', `/generations/${failed.id}/approve`, 'marketing')).json().code).toBe('AI_GENERATION_NOT_READY');
    expect((await call('DELETE', `/generations/${failed.id}`, 'marketing')).statusCode).toBe(200);
  });

  it('OpenAI: envia multipart (imagem, instrução, tamanho pela proporção); aplica o limite mensal só a provedores pagos', async () => {
    const used = (await call('GET', '/ai/settings', 'admin')).json().usage.generations as number; // o consumo do mês acumula entre os testes
    await configure({ provider: 'openai', apiKey: GOOD, monthlyLimit: used + 2 });
    const m = await newPhoto();
    const g = (await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'VIRTUAL_STAGE', style: 'escandinavo' })).json().generations[0];
    expect(g).toMatchObject({ status: 'READY', provider: 'openai', model: 'gpt-image-1.5', cost: 0.08, style: 'escandinavo' });
    const f = seen[0]!.form!;
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${GOOD}`);
    expect(f.get('model')).toBe('gpt-image-1.5');
    expect(f.get('size')).toBe('1536x1024');
    expect(f.get('input_fidelity')).toBe('high');
    expect(String(f.get('prompt'))).toContain('Scandinavian');
    expect(f.get('image[]')).toBeInstanceOf(Blob);

    // limite: 2 novas edições no mês (a de cima já contou 1)
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE', parentId: g.id })).statusCode).toBe(201);
    const third = await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE', parentId: g.id });
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe('AI_LIMIT_REACHED');
    const usage = (await call('GET', '/ai/settings', 'admin')).json().usage;
    expect(usage.generations).toBe(used + 2);
    expect(usage.cost).toBeGreaterThan(0);
    await configure({ provider: 'local' });
    expect((await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE' })).statusCode).toBe(201); // o modo local é gratuito e ilimitado
  });

  it('excluir a foto apaga as versões de IA (arquivos e registros)', async () => {
    await configure({ provider: 'gemini', apiKey: GOOD, monthlyLimit: 100 });
    const m = await newPhoto();
    const g = (await call('POST', `/media/${m.id}/generations`, 'marketing', { operation: 'ENHANCE' })).json().generations[0];
    const row = await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: g.id } });
    expect(await storage.head(row.outputKey!)).not.toBeNull();
    expect((await call('DELETE', `/media/${m.id}`, 'admin')).statusCode).toBe(204);
    expect(await storage.head(row.outputKey!)).toBeNull();
    expect(await storage.head(row.thumbKey!)).toBeNull();
    expect(await prisma.mediaGeneration.count({ where: { mediaId: m.id } })).toBe(0);
    await configure({ provider: 'local' });
  });
});

// Fila real (BullMQ + Redis). Só roda quando TEST_REDIS_URL aponta para um Redis disponível.
describe.skipIf(!process.env.TEST_REDIS_URL)('fila BullMQ da IA', () => {
  it('a edição roda em segundo plano (a requisição volta antes) e a aprovação é renderizada pela fila de mídia', async () => {
    const queued = await bootApp({ REDIS_URL: process.env.TEST_REDIS_URL! });
    try {
      const t = (await login(queued, 'admin.a@teste.com')).body.accessToken;
      const c = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => queued.inject({ method, url: `/api/v1${url}`, headers: auth(t), payload: payload as never });
      expect((await c('PUT', '/ai/settings', { provider: 'gemini', apiKey: GOOD, monthlyLimit: 1000 })).statusCode).toBe(200);
      const up = await uploadPhoto(queued, t, prop.id, { buffer: await solid(1200, 800, [200, 160, 90]) });
      const id = up.confirm!.json().id as string;
      await vi.waitFor(async () => expect((await prisma.propertyMedia.findUniqueOrThrow({ where: { id } })).status).toBe('READY'), { timeout: 15000 });

      const r = await c('POST', `/media/${id}/generations`, { operation: 'ENHANCE' });
      expect(r.statusCode).toBe(201);
      const genId = r.json().generations[0].id as string;
      await vi.waitFor(async () => expect((await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: genId } })).status).toBe('READY'), { timeout: 15000 });

      expect((await c('POST', `/generations/${genId}/approve`)).statusCode).toBe(200);
      await vi.waitFor(async () => expect((await prisma.propertyMedia.findUniqueOrThrow({ where: { id } })).renderedGenerationId).toBe(genId), { timeout: 15000 });
      const row = await prisma.propertyMedia.findUniqueOrThrow({ where: { id } });
      expect(near(await pixel(await queued.get(StorageService).read(row.processedKey!), 50, 50), [30, 60, 200], 20)).toBe(true); // storage do próprio app com Redis
      await c('PUT', '/ai/settings', { provider: 'local' });
    } finally { await queued.close(); }
  }, 60000);
});
