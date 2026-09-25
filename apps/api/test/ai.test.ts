import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { findImage } from '../src/ai/providers/gemini.provider';
import { AiImagesService } from '../src/ai/ai-images.service';
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
  if (/\/models/.test(url)) {
    if (key !== GOOD) return json({ error: { message: 'bad key' } }, 401);
    return /generativelanguage/.test(url)
      ? json({ models: [
        { name: 'models/gemini-3.1-flash-image', displayName: 'Gemini Flash Image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-pro', displayName: 'Gemini Pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-3.1-flash-lite', displayName: 'Gemini Flash Lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/imagen-4', displayName: 'Imagen 4', supportedGenerationMethods: ['predict'] },
        { name: 'models/gemini-live-x', displayName: 'Live', supportedGenerationMethods: ['generateContent'] },
      ] })
      : json({ data: ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4o', 'gpt-4o-2024-08-06', 'text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3'].map((id) => ({ id })) });
  }
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
const LOCAL = 'local';
const NO_OP_DEFAULTS = { ENHANCE: null, LIGHTING: null, REMOVE_OBJECT: null, REMOVE_FURNITURE: null, VIRTUAL_STAGE: null, SKY_REPLACEMENT: null }; // null limpa o padrão do tipo de edição
interface M { id: string; label: string; model: string; tier: string; costUsd: number; enabled: boolean }
const settings = async (who = 'admin') => (await call('GET', '/ai/settings', who)).json();
const discover = async (provider: string, apiKey = GOOD) => (await call('POST', '/ai/discover', 'admin', { provider, apiKey })).json() as { model: string; label: string; guess: string; tier: string; costUsd: number; added: boolean }[];
/** Cadastra a conta como a tela faz: lista os modelos pela chave e escolhe os das finalidades pedidas. */
async function connect(provider: string, name: string, kinds: string[] = ['IMAGE'], apiKey = GOOD) {
  const found = await discover(provider, apiKey);
  const models = found.filter((m) => kinds.includes(m.guess)).map((m) => ({ label: m.label, model: m.model, kind: m.guess, tier: m.tier, costUsd: m.costUsd, inputCostPerMTok: null, outputCostPerMTok: null }));
  return call('POST', '/ai/accounts', 'admin', { name, provider, apiKey, models });
}
const account = (over: { name?: string; provider?: string; apiKey?: string } = {}) => connect(over.provider ?? 'gemini', over.name ?? 'Conta', ['IMAGE'], over.apiKey ?? GOOD);
const modelOf = async (name: string, model: string): Promise<M> => (await settings()).accounts.find((a: { name: string }) => a.name === name).models.find((m: M) => m.model === model);
const gen = (mediaId: string, body: object, who = 'marketing') => call('POST', `/media/${mediaId}/generations`, who, body);
let geminiId = '';
let openaiIds: { premium: string; standard: string; mini: string } = { premium: '', standard: '', mini: '' };


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
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><defs><linearGradient id="g"><stop offset="0" stop-color="#1e1e1e"/><stop offset="1" stop-color="#787878"/></linearGradient></defs><rect width="200" height="150" fill="url(#g)"/></svg>';
    const dark = await sharp(Buffer.from(svg)).png().toBuffer();
    const mean = async (b: Buffer) => (await sharp(b).stats()).channels[0]!.mean;
    const lit = await local.improveLighting({ image: dark, mimeType: 'image/png', width: 200, height: 150 });
    expect(lit.costUsd).toBe(0);
    expect(await mean(lit.image)).toBeGreaterThan(await mean(dark));
    await expect(local.virtualStage({ image: dark, mimeType: 'image/png', width: 200, height: 150 })).rejects.toThrow(/provedor de IA/);
  });
});

describe('descoberta de modelos pela chave', () => {
  it('lista o que a chave dá acesso, separa imagem e texto, sugere nível, ignora versões datadas e exige permissão/chave válida', async () => {
    expect((await call('POST', '/ai/discover', 'marketing', { provider: 'openai', apiKey: GOOD })).statusCode).toBe(403);
    expect((await call('POST', '/ai/discover', 'admin', { provider: 'openai', apiKey: 'CHAVE-ERRADA-123456' })).json().code).toBe('AI_KEY_INVALID');
    expect((await call('POST', '/ai/discover', 'admin', { provider: 'claude', apiKey: GOOD })).statusCode).toBe(400);

    const o = await discover('openai');
    const by = (l: typeof o, kind: string) => l.filter((m) => m.guess === kind).map((m) => m.model);
    expect(by(o, 'IMAGE')).toEqual(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5']);
    expect(by(o, 'TEXT')).toEqual(['gpt-4o', 'gpt-5.4', 'gpt-5.4-mini']); // sem o snapshot datado gpt-4o-2024-08-06
    expect(by(o, 'OTHER')).toEqual(expect.arrayContaining(['text-embedding-3-small', 'whisper-1', 'tts-1', 'dall-e-3']));
    const tier = Object.fromEntries(o.map((m) => [m.model, m.tier]));
    expect([tier['gpt-image-1.5'], tier['gpt-image-1'], tier['gpt-image-1-mini'], tier['gpt-5.4-mini'], tier['gpt-4o']]).toEqual(['PREMIUM', 'STANDARD', 'ECONOMIC', 'ECONOMIC', 'STANDARD']);
    expect(o.find((m) => m.model === 'gpt-image-1.5')!.costUsd).toBe(0.13); // custo conhecido pré-preenchido

    const g = await discover('gemini');
    expect(by(g, 'IMAGE')).toEqual(['gemini-3.1-flash-image']);
    expect(by(g, 'TEXT')).toEqual(['gemini-3.1-flash-lite', 'gemini-3.1-pro']);
    expect(by(g, 'OTHER')).toEqual(expect.arrayContaining(['text-embedding-004', 'imagen-4', 'gemini-live-x'])); // sem generateContent ou fora do escopo
    expect(g.find((m) => m.model === 'gemini-3.1-pro')!.tier).toBe('PREMIUM');
    expect(g.find((m) => m.model === 'gemini-3.1-flash-lite')!.tier).toBe('ECONOMIC');
  });
});

describe('contas de IA e modelos por nível', () => {
  it('começa só com o modelo embutido; só quem administra a empresa configura; a chave é validada, criptografada, mascarada e nunca devolvida', async () => {
    expect(await settings()).toMatchObject({ accounts: [], defaultModelId: null, monthlyLimit: 100, usage: { generations: 0, cost: 0 } });
    expect((await settings()).catalog.map((c: { id: string }) => c.id)).toEqual(['openai', 'gemini']);
    const st = (await call('GET', '/ai/status', 'marketing')).json();
    expect(st.choices).toHaveLength(1);
    expect(st).toMatchObject({ defaultModelId: LOCAL, choices: [{ id: LOCAL, tier: null, costUsd: 0 }] });
    for (const [m, u, b] of [['GET', '/ai/settings', undefined], ['PUT', '/ai/settings', { monthlyLimit: 5 }], ['POST', '/ai/accounts', { name: 'X1', provider: 'gemini', apiKey: GOOD }]] as const) {
      expect((await call(m as never, u, 'marketing', b)).statusCode).toBe(403);
    }
    expect((await call('GET', '/ai/status', 'broker')).statusCode).toBe(403);

    expect((await call('POST', '/ai/accounts', 'admin', { name: 'Conta', provider: 'claude', apiKey: GOOD, models: [] })).statusCode).toBe(400);
    expect((await call('POST', '/ai/accounts', 'admin', { name: 'a', provider: 'gemini', apiKey: GOOD, models: [] })).statusCode).toBe(400);
    expect((await call('POST', '/ai/accounts', 'admin', { name: 'Conta', provider: 'gemini', apiKey: 'curta', models: [] })).statusCode).toBe(400);
    const bad = await call('POST', '/ai/accounts', 'admin', { name: 'Conta errada', provider: 'gemini', apiKey: 'CHAVE-ERRADA-123456', models: [] });
    expect(bad.json().code).toBe('AI_KEY_INVALID');
    expect((await settings()).accounts).toHaveLength(0); // recusada não grava

    const ok = await account({ name: 'Gemini da matriz', provider: 'gemini' });
    expect(ok.statusCode).toBe(201);
    const acc = ok.json().accounts[0];
    expect(acc).toMatchObject({ name: 'Gemini da matriz', provider: 'gemini', active: true, keyHint: '••••7890' });
    expect(acc.models.map((m: M) => [m.model, m.tier])).toEqual([['gemini-3.1-flash-image', 'STANDARD']]);
    geminiId = acc.models[0].id;
    expect(JSON.stringify(ok.json())).not.toContain(GOOD);
    expect((await prisma.aiAccount.findFirstOrThrow({ where: { name: 'Gemini da matriz' } })).secrets).not.toContain(GOOD);
  });

  it('várias contas (inclusive do mesmo provedor), cada uma com modelos do mais econômico ao mais forte; editar, desativar e remover', async () => {
    const a1 = (await connect('openai', 'OpenAI da matriz')).json();
    const a2 = (await connect('openai', 'OpenAI do marketing')).json();
    expect(a2.accounts.map((a: { name: string }) => a.name)).toEqual(['Gemini da matriz', 'OpenAI da matriz', 'OpenAI do marketing']); // duas contas do mesmo provedor
    const models: M[] = a1.accounts.find((a: { name: string }) => a.name === 'OpenAI da matriz').models;
    expect(models.map((m) => [m.model, m.tier])).toEqual([['gpt-image-1-mini', 'ECONOMIC'], ['gpt-image-1', 'STANDARD'], ['gpt-image-1.5', 'PREMIUM']]); // do fraco ao forte
    openaiIds = { mini: models[0]!.id, standard: models[1]!.id, premium: models[2]!.id };

    // modelo próprio: valida, não repete o ID na conta, edita nível/custo e desativa
    const accId = a2.accounts.find((a: { name: string }) => a.name === 'OpenAI da matriz').id;
    expect((await call('POST', `/ai/accounts/${accId}/models`, 'admin', { label: 'X', model: 'ok', kind: 'IMAGE', tier: 'PREMIUM', costUsd: 1 })).statusCode).toBe(400);
    expect((await call('POST', `/ai/accounts/${accId}/models`, 'admin', { label: 'Modelo novo', model: 'gpt image!', kind: 'IMAGE', tier: 'PREMIUM', costUsd: 1 })).statusCode).toBe(400);
    expect((await call('POST', `/ai/accounts/${accId}/models`, 'admin', { label: 'Mini de novo', model: 'gpt-image-1-mini', kind: 'IMAGE', tier: 'ECONOMIC', costUsd: 0.02 })).json().code).toBe('AI_ACCOUNT_DUPLICATE');
    const added = await call('POST', `/ai/accounts/${accId}/models`, 'admin', { label: 'GPT Image 2 (teste)', model: 'gpt-image-2', kind: 'IMAGE', tier: 'PREMIUM', costUsd: 0.2 });
    expect(added.statusCode).toBe(201);
    const custom = await modelOf('OpenAI da matriz', 'gpt-image-2');
    expect(custom).toMatchObject({ tier: 'PREMIUM', costUsd: 0.2, enabled: true });
    expect((await call('PATCH', `/ai/models/${custom.id}`, 'admin', { tier: 'STANDARD', costUsd: 0.1, enabled: false })).statusCode).toBe(200);
    expect(await modelOf('OpenAI da matriz', 'gpt-image-2')).toMatchObject({ tier: 'STANDARD', costUsd: 0.1, enabled: false });
    expect((await call('PATCH', `/ai/models/${custom.id}`, 'adminB', { enabled: true })).statusCode).toBe(404); // outra empresa
    expect((await call('DELETE', `/ai/models/${custom.id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('DELETE', `/ai/models/${custom.id}`, 'admin')).statusCode).toBe(200);

    // o estúdio só vê modelos ativos de contas ativas, do mais econômico ao mais forte, com o embutido primeiro
    let ids = ((await call('GET', '/ai/status', 'marketing')).json().choices as { id: string; tier: string | null; accountName: string | null }[]);
    expect(ids[0]!.id).toBe(LOCAL);
    expect(ids.filter((c) => c.accountName === 'OpenAI da matriz').map((c) => c.tier)).toEqual(['ECONOMIC', 'STANDARD', 'PREMIUM']);
    await call('PATCH', `/ai/models/${openaiIds.mini}`, 'admin', { enabled: false });
    const acc2 = (await settings()).accounts.find((a: { name: string }) => a.name === 'OpenAI do marketing');
    await call('PATCH', `/ai/accounts/${acc2.id}`, 'admin', { active: false, name: 'OpenAI (pausada)' });
    ids = (await call('GET', '/ai/status', 'marketing')).json().choices;
    expect(ids.some((c) => c.id === openaiIds.mini)).toBe(false);
    expect(ids.some((c) => c.accountName === 'OpenAI (pausada)')).toBe(false);
    await call('PATCH', `/ai/models/${openaiIds.mini}`, 'admin', { enabled: true });
    expect((await call('PATCH', `/ai/accounts/${acc2.id}`, 'admin', { apiKey: 'CHAVE-ERRADA-123456' })).json().code).toBe('AI_KEY_INVALID');
    expect((await call('PATCH', `/ai/accounts/${acc2.id}`, 'adminB', { name: 'invadida' })).statusCode).toBe(404);
    expect((await call('DELETE', `/ai/accounts/${acc2.id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('DELETE', `/ai/accounts/${acc2.id}`, 'admin')).statusCode).toBe(200);
    expect(await prisma.aiModel.count({ where: { accountId: acc2.id } })).toBe(0); // os modelos saem junto
    expect((await settings('adminB')).accounts).toHaveLength(0); // cada empresa tem as suas
  });

  it('padrão geral e por tipo de edição (econômico para ajustar, premium para decorar); ids inválidos são recusados', async () => {
    expect((await call('PUT', '/ai/settings', 'admin', { defaultModelId: '00000000-0000-7000-8000-000000000000' })).json().code).toBe('AI_MODEL_INVALID');
    expect((await call('PUT', '/ai/settings', 'admin', { operationDefaults: { ENHANCE: '00000000-0000-7000-8000-000000000000' } })).json().code).toBe('AI_MODEL_INVALID');
    expect((await call('PUT', '/ai/settings', 'admin', { operationDefaults: { INVENTADA: LOCAL } })).statusCode).toBe(400);
    expect((await call('PUT', '/ai/settings', 'adminB', { defaultModelId: openaiIds.standard })).json().code).toBe('AI_MODEL_INVALID'); // modelo de outra empresa

    const r = await call('PUT', '/ai/settings', 'admin', { monthlyLimit: 500, defaultModelId: openaiIds.standard, operationDefaults: { ENHANCE: openaiIds.mini, VIRTUAL_STAGE: openaiIds.premium, LIGHTING: LOCAL } });
    expect(r.json()).toMatchObject({ monthlyLimit: 500, defaultModelId: openaiIds.standard, operationDefaults: { ENHANCE: openaiIds.mini, VIRTUAL_STAGE: openaiIds.premium, LIGHTING: LOCAL } });
    const st = (await call('GET', '/ai/status', 'marketing')).json();
    expect(st).toMatchObject({ defaultModelId: openaiIds.standard, operationDefaults: { ENHANCE: openaiIds.mini, VIRTUAL_STAGE: openaiIds.premium }, monthlyLimit: 500 });
    // edição parcial mantém o resto
    expect((await call('PUT', '/ai/settings', 'admin', { operationDefaults: { REMOVE_OBJECT: openaiIds.premium } })).json().operationDefaults).toMatchObject({ ENHANCE: openaiIds.mini, REMOVE_OBJECT: openaiIds.premium });
    expect((await call('PUT', '/ai/settings', 'admin', { defaultModelId: null })).json().defaultModelId).toBeNull();
  });
});

describe('versões por IA: escolha do modelo, original preservado, aprovação e reversão', () => {
  it('modelo embutido: melhora a foto como versão nova sem tocar no original; operações generativas pedem um provedor; permissões e multiempresa', async () => {
    const m = await newPhoto();
    const before = await m.row();
    const originalBytes = await storage.read(before.originalKey);

    expect((await gen(m.id, { operation: 'ENHANCE', modelId: LOCAL }, 'broker')).statusCode).toBe(403);
    expect((await gen(m.id, { operation: 'ENHANCE', modelId: LOCAL }, 'adminB')).statusCode).toBe(404);
    expect((await gen(m.id, { operation: 'REMOVE_FURNITURE', modelId: LOCAL })).json().code).toBe('AI_OPERATION_UNSUPPORTED');
    expect((await gen(m.id, { operation: 'NADA' })).statusCode).toBe(400);
    expect((await gen(m.id, { operation: 'ENHANCE', modelId: '00000000-0000-7000-8000-000000000000' })).json().code).toBe('AI_MODEL_INVALID');

    const r = await gen(m.id, { operation: 'ENHANCE', modelId: LOCAL });
    expect(r.statusCode).toBe(201);
    const g = r.json().generations[0];
    expect(g).toMatchObject({ operation: 'ENHANCE', status: 'READY', provider: 'local', cost: 0, active: false, parentId: null, accountName: null });
    expect(Buffer.compare(await storage.read(before.originalKey), originalBytes)).toBe(0);
    expect(await m.row()).toMatchObject({ aiModified: false, activeGenerationId: null, processedKey: before.processedKey });
    expect((await call('GET', `/media/${m.id}/versions`, 'broker')).statusCode).toBe(200);
    expect((await call('GET', `/media/${m.id}/versions`, 'adminB')).statusCode).toBe(404);
  });

  it('usa o modelo escolhido, ou o padrão do tipo de edição, ou o padrão geral; registra conta, modelo e custo de cada um', async () => {
    await call('PUT', '/ai/settings', 'admin', { defaultModelId: openaiIds.standard, operationDefaults: { ...NO_OP_DEFAULTS, ENHANCE: openaiIds.mini, VIRTUAL_STAGE: openaiIds.premium } });
    const m = await newPhoto();
    const pick = async (body: object) => { const gs = (await gen(m.id, body)).json().generations; return gs.at(-1) as { model: string; cost: number; accountName: string; provider: string; status: string }; };

    expect(await pick({ operation: 'ENHANCE' })).toMatchObject({ model: 'gpt-image-1-mini', cost: 0.02, accountName: 'OpenAI da matriz', provider: 'openai', status: 'READY' }); // padrão da operação
    expect(await pick({ operation: 'LIGHTING' })).toMatchObject({ model: 'gpt-image-1', cost: 0.08 }); // padrão geral
    expect(await pick({ operation: 'VIRTUAL_STAGE', style: 'moderno' })).toMatchObject({ model: 'gpt-image-1.5', cost: 0.13 }); // padrão da operação (premium)
    expect(await pick({ operation: 'ENHANCE', modelId: geminiId })).toMatchObject({ model: 'gemini-3.1-flash-image', provider: 'gemini', accountName: 'Gemini da matriz' }); // escolha explícita
    expect(seen.map((s) => (s.form?.get('model') ?? s.body.model))).toEqual(['gpt-image-1-mini', 'gpt-image-1', 'gpt-image-1.5', 'gemini-3.1-flash-image']);

    // padrão que não atende à operação (embutido não decora) cai no próximo; sem padrão, usa o primeiro "padrão" cadastrado
    await call('PUT', '/ai/settings', 'admin', { defaultModelId: null, operationDefaults: { ...NO_OP_DEFAULTS, REMOVE_FURNITURE: LOCAL } });
    seen.length = 0;
    expect((await pick({ operation: 'REMOVE_FURNITURE' })).provider).not.toBe('local');
    expect(seen).toHaveLength(1);
    // modelo desativado deixa de valer como escolha e como padrão
    await call('PATCH', `/ai/models/${openaiIds.premium}`, 'admin', { enabled: false });
    expect((await gen(m.id, { operation: 'ENHANCE', modelId: openaiIds.premium })).json().code).toBe('AI_MODEL_INVALID');
    await call('PATCH', `/ai/models/${openaiIds.premium}`, 'admin', { enabled: true });
    await call('PUT', '/ai/settings', 'admin', { defaultModelId: null, operationDefaults: NO_OP_DEFAULTS });
  });

  it('com Gemini: manda a foto e a instrução, registra custo, aprova para publicar, mostra o aviso no site e volta ao original', async () => {
    const m = await newPhoto([200, 160, 90]);
    const orig = await m.row();
    const originalBytes = await storage.read(orig.originalKey);

    expect((await gen(m.id, { operation: 'REMOVE_OBJECT', modelId: geminiId })).json().code).toBe('AI_PROMPT_REQUIRED');
    const r = await gen(m.id, { operation: 'REMOVE_OBJECT', prompt: 'o carro vermelho na garagem', modelId: geminiId });
    expect(r.statusCode).toBe(201);
    const g = r.json().generations[0];
    expect(g).toMatchObject({ status: 'READY', provider: 'gemini', model: 'gemini-3.1-flash-image', cost: 0.04, prompt: 'o carro vermelho na garagem' });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers['x-goog-api-key']).toBe(GOOD);
    expect(seen[0]!.url).toMatch(/\/interactions$/);
    expect(seen[0]!.body.input[0].text).toContain('o carro vermelho na garagem');
    expect(seen[0]!.body.input[1]).toMatchObject({ type: 'image', mime_type: 'image/jpeg' });

    const out = await storage.read((await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: g.id } })).outputKey!);
    const meta = await sharp(out).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(1.5, 1); // manteve a proporção da foto
    expect(near(await pixel(out, 50, 50), [30, 60, 200], 20)).toBe(true);

    expect((await m.row()).aiModified).toBe(false);
    expect(near(await pixel(await storage.read((await m.row()).processedKey!), 50, 50), [200, 160, 90], 14)).toBe(true);

    const ap = await call('POST', `/generations/${g.id}/approve`, 'marketing');
    expect(ap.json()).toMatchObject({ activeGenerationId: g.id });
    const approved = await m.row();
    expect(approved).toMatchObject({ aiModified: true, activeGenerationId: g.id, renderedGenerationId: g.id });
    expect(approved.processedKey).not.toBe(orig.processedKey);
    expect(near(await pixel(await storage.read(approved.processedKey!), 50, 50), [30, 60, 200], 20)).toBe(true);
    expect(Buffer.compare(await storage.read(orig.originalKey), originalBytes)).toBe(0);
    expect(await storage.head(orig.processedKey!)).toBeNull();

    await call('POST', `/properties/${prop.id}/publish`, 'admin');
    const pub = await app.inject({ method: 'GET', url: `/api/v1/public/properties/${prop.slug}` });
    expect(pub.json().media.find((x: { id: string }) => x.id === m.id).aiModified).toBe(true);

    const rv = await call('POST', `/media/${m.id}/revert`, 'marketing');
    expect(rv.json().activeGenerationId).toBeNull();
    expect(await m.row()).toMatchObject({ aiModified: false, activeGenerationId: null, renderedGenerationId: null });
    expect(near(await pixel(await storage.read((await m.row()).processedKey!), 50, 50), [200, 160, 90], 14)).toBe(true);
    expect(rv.json().generations).toHaveLength(1);
  });

  it('encadeia versões (geração 2 parte da geração 1), não deixa duas edições ao mesmo tempo e só descarta versões livres', async () => {
    const m = await newPhoto();
    const g1 = (await gen(m.id, { operation: 'LIGHTING', modelId: geminiId })).json().generations[0];
    const firstInput = seen[0]!.body.input[1].data as string;
    const g2 = (await gen(m.id, { operation: 'ENHANCE', parentId: g1.id, modelId: geminiId })).json().generations.find((g: { parentId: string }) => g.parentId === g1.id);
    expect(g2).toMatchObject({ status: 'READY', parentId: g1.id });
    expect(seen[1]!.body.input[1].data).not.toBe(firstInput);
    const out1 = await sharp(Buffer.from(seen[1]!.body.input[1].data, 'base64')).raw().toBuffer({ resolveWithObject: true });
    expect(out1.data[0]! < 80 && out1.data[2]! > 150).toBe(true); // a 2ª edição partiu da imagem gerada (azul)

    expect((await call('DELETE', `/generations/${g1.id}`, 'marketing')).json().code).toBe('AI_GENERATION_IN_USE');
    await call('POST', `/generations/${g2.id}/approve`, 'marketing');
    expect((await call('DELETE', `/generations/${g2.id}`, 'marketing')).json().code).toBe('AI_GENERATION_IN_USE');
    expect((await call('POST', `/generations/${g2.id}/approve`, 'adminB')).statusCode).toBe(404);
    await call('POST', `/media/${m.id}/revert`, 'marketing');
    const outKey = (await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: g2.id } })).outputKey!;
    expect((await call('DELETE', `/generations/${g2.id}`, 'marketing')).statusCode).toBe(200);
    expect(await storage.head(outKey)).toBeNull();
    expect((await gen(m.id, { operation: 'ENHANCE', parentId: '00000000-0000-7000-8000-000000000000', modelId: geminiId })).json().code).toBe('AI_GENERATION_NOT_READY');

    await prisma.mediaGeneration.create({ data: { companyId: (await prisma.propertyMedia.findUniqueOrThrow({ where: { id: m.id } })).companyId, propertyId: prop.id, mediaId: m.id, operation: 'ENHANCE', provider: 'gemini', inputKey: 'x', status: 'PROCESSING' } });
    expect((await gen(m.id, { operation: 'ENHANCE', modelId: geminiId })).json().code).toBe('AI_GENERATION_BUSY');
    await prisma.mediaGeneration.updateMany({ where: { mediaId: m.id, status: 'PROCESSING' }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    expect((await gen(m.id, { operation: 'ENHANCE', modelId: geminiId })).statusCode).toBe(201);
  });

  it('falhas do provedor viram mensagem clara, não custam nada e não travam a foto; conta removida vira erro explicado', async () => {
    const m = await newPhoto();
    const usage0 = (await settings()).usage;
    const attempt = async (md: typeof mode) => { mode = md; return (await gen(m.id, { operation: 'ENHANCE', modelId: geminiId })).json().generations.at(-1); };
    const cases: [typeof mode, RegExp][] = [['http500', /instável/], ['http429', /limite/], ['safety', /política/], ['noimage', /não devolveu uma imagem/], ['badkey', /recusou a chave/]];
    for (const [md, re] of cases) {
      const g = await attempt(md);
      expect(g).toMatchObject({ status: 'FAILED', cost: 0 });
      expect(g.error).toMatch(re);
    }
    expect((await settings()).usage).toEqual(usage0);
    expect(await m.row()).toMatchObject({ aiModified: false, status: 'READY' });
    const failed = (await call('GET', `/media/${m.id}/versions`, 'marketing')).json().generations[0];
    expect((await call('POST', `/generations/${failed.id}/approve`, 'marketing')).json().code).toBe('AI_GENERATION_NOT_READY');
    expect((await call('DELETE', `/generations/${failed.id}`, 'marketing')).statusCode).toBe(200);

    // a conta some entre o pedido e a execução: falha explicada, sem cobrar
    const tmp = (await connect('gemini', 'Conta temporária')).json().accounts.find((a: { name: string }) => a.name === 'Conta temporária');
    const row = await prisma.mediaGeneration.create({ data: { companyId: (await prisma.propertyMedia.findUniqueOrThrow({ where: { id: m.id } })).companyId, propertyId: prop.id, mediaId: m.id, operation: 'ENHANCE', provider: 'gemini', model: 'gemini-3.1-flash-image', accountId: tmp.id, modelId: tmp.models[0].id, inputKey: (await m.row()).originalKey } });
    await call('DELETE', `/ai/accounts/${tmp.id}`, 'admin');
    await app.get(AiImagesService).run(row.id);
    expect(await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'FAILED', cost: expect.anything() });
    expect((await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: row.id } })).error).toMatch(/foi removida/);
  });

  it('OpenAI: envia multipart (modelo escolhido, imagem, instrução, tamanho pela proporção); o limite mensal vale só para modelos pagos', async () => {
    const used = (await settings()).usage.generations as number;
    await call('PUT', '/ai/settings', 'admin', { monthlyLimit: used + 2 });
    const m = await newPhoto();
    const g = (await gen(m.id, { operation: 'VIRTUAL_STAGE', style: 'escandinavo', modelId: openaiIds.premium })).json().generations[0];
    expect(g).toMatchObject({ status: 'READY', provider: 'openai', model: 'gpt-image-1.5', cost: 0.13, style: 'escandinavo' });
    const f = seen[0]!.form!;
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${GOOD}`);
    expect(f.get('model')).toBe('gpt-image-1.5');
    expect(f.get('size')).toBe('1536x1024');
    expect(f.get('input_fidelity')).toBe('high');
    expect(String(f.get('prompt'))).toContain('Scandinavian');
    expect(f.get('image[]')).toBeInstanceOf(Blob);
    seen.length = 0;
    await gen(m.id, { operation: 'ENHANCE', parentId: g.id, modelId: openaiIds.mini });
    expect(seen[0]!.form!.has('input_fidelity')).toBe(false); // o "mini" não usa essa opção

    const third = await gen(m.id, { operation: 'ENHANCE', parentId: g.id, modelId: openaiIds.standard });
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe('AI_LIMIT_REACHED');
    const usage = (await settings()).usage;
    expect(usage.generations).toBe(used + 2);
    expect(usage.cost).toBeGreaterThan(0);
    // o consumo por modelo aparece na configuração
    expect((await modelOf('OpenAI da matriz', 'gpt-image-1.5') as M & { uses: number }).uses).toBeGreaterThanOrEqual(1);
    expect((await gen(m.id, { operation: 'ENHANCE', modelId: LOCAL })).statusCode).toBe(201); // embutido: gratuito e ilimitado
    await call('PUT', '/ai/settings', 'admin', { monthlyLimit: 100 });
  });

  it('excluir a foto apaga as versões de IA (arquivos e registros)', async () => {
    const m = await newPhoto();
    const g = (await gen(m.id, { operation: 'ENHANCE', modelId: geminiId })).json().generations[0];
    const row = await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: g.id } });
    expect(await storage.head(row.outputKey!)).not.toBeNull();
    expect((await call('DELETE', `/media/${m.id}`, 'admin')).statusCode).toBe(204);
    expect(await storage.head(row.outputKey!)).toBeNull();
    expect(await storage.head(row.thumbKey!)).toBeNull();
    expect(await prisma.mediaGeneration.count({ where: { mediaId: m.id } })).toBe(0);
  });
});

// Fila real (BullMQ + Redis). Só roda quando TEST_REDIS_URL aponta para um Redis disponível.
describe.skipIf(!process.env.TEST_REDIS_URL)('fila BullMQ da IA', () => {
  it('a edição roda em segundo plano (a requisição volta antes) e a aprovação é renderizada pela fila de mídia', async () => {
    const queued = await bootApp({ REDIS_URL: process.env.TEST_REDIS_URL! });
    try {
      const t = (await login(queued, 'admin.a@teste.com')).body.accessToken;
      const c = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => queued.inject({ method, url: `/api/v1${url}`, headers: auth(t), payload: payload as never });
      const up = await uploadPhoto(queued, t, prop.id, { buffer: await solid(1200, 800, [200, 160, 90]) });
      const id = up.confirm!.json().id as string;
      await vi.waitFor(async () => expect((await prisma.propertyMedia.findUniqueOrThrow({ where: { id } })).status).toBe('READY'), { timeout: 15000 });

      const r = await c('POST', `/media/${id}/generations`, { operation: 'ENHANCE', modelId: geminiId });
      expect(r.statusCode).toBe(201);
      const genId = r.json().generations[0].id as string;
      await vi.waitFor(async () => expect((await prisma.mediaGeneration.findUniqueOrThrow({ where: { id: genId } })).status).toBe('READY'), { timeout: 15000 });

      expect((await c('POST', `/generations/${genId}/approve`)).statusCode).toBe(200);
      await vi.waitFor(async () => expect((await prisma.propertyMedia.findUniqueOrThrow({ where: { id } })).renderedGenerationId).toBe(genId), { timeout: 15000 });
      const row = await prisma.propertyMedia.findUniqueOrThrow({ where: { id } });
      expect(near(await pixel(await queued.get(StorageService).read(row.processedKey!), 50, 50), [30, 60, 200], 20)).toBe(true);
    } finally { await queued.close(); }
  }, 60000);
});
