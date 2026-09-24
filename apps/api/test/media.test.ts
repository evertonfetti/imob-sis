import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { auth, bootApp, login, makeImage, resetAndSeed, uploadPhoto } from './helpers';

let app: NestFastifyApplication;
let admin: { accessToken: string };
let broker: { accessToken: string };
let adminB: { accessToken: string };
let typeId: string;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload: payload as never });
const newProperty = async (token = admin.accessToken) =>
  (await call('POST', '/properties', token, { title: 'Casa com jardim', purpose: 'SALE', typeId, salePrice: 900000, city: 'Campinas', neighborhood: 'Cambuí' })).json();

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  admin = (await login(app, 'admin.a@teste.com')).body;
  broker = (await login(app, 'broker.a@teste.com')).body;
  adminB = (await login(app, 'admin.b@teste.com')).body;
  typeId = (await call('GET', '/property-types', admin.accessToken)).json()[0].id;
});
afterAll(async () => { await app.close(); });

describe('upload', () => {
  it('upload válido: envia, confirma, gera versão otimizada + miniatura e define a capa', async () => {
    const p = await newProperty();
    const big = await makeImage(3200, 2000, 'jpeg');
    const { put, confirm } = await uploadPhoto(app, admin.accessToken, p.id, { buffer: big, contentType: 'image/jpeg' });
    expect(put!.statusCode).toBe(200);
    expect(confirm!.statusCode).toBe(201);
    const m = confirm!.json();
    expect(m).toMatchObject({ status: 'READY', isCover: true, position: 0, type: 'IMAGE' });
    expect(Math.max(m.width, m.height)).toBe(2400); // reduzido do original 3200px

    const thumb = await app.inject({ method: 'GET', url: new URL(m.thumbnailUrl, 'http://x').pathname });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const meta = await sharp(thumb.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([480, 360]);

    // o original permanece intacto no storage
    const original = await app.inject({ method: 'GET', url: new URL(m.originalUrl, 'http://x').pathname });
    expect(original.rawPayload.length).toBe(big.length);

    const detail = (await call('GET', `/properties/${p.id}`, admin.accessToken)).json();
    expect(detail.mediaCount).toBe(1);
    expect(detail.coverUrl).toBe(m.thumbnailUrl);
  });

  it('rejeita tipo inválido, arquivo grande demais, assinatura adulterada e envio sem confirmação', async () => {
    const p = await newProperty();
    const exe = await uploadPhoto(app, admin.accessToken, p.id, { contentType: 'application/x-msdownload' });
    expect(exe.target.statusCode).toBe(400);
    expect(exe.target.json().code).toBe('MEDIA_TYPE_INVALID');

    const huge = await call('POST', `/properties/${p.id}/media/upload-url`, admin.accessToken, { type: 'IMAGE', filename: 'x.jpg', contentType: 'image/jpeg', size: 80 * 1024 * 1024 });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().code).toBe('MEDIA_TOO_LARGE');

    const ok = await call('POST', `/properties/${p.id}/media/upload-url`, admin.accessToken, { type: 'IMAGE', filename: 'x.png', contentType: 'image/png', size: 1000 });
    const u = new URL(ok.json().uploadUrl);
    u.searchParams.set('key', u.searchParams.get('key')!.replace('original', 'outro'));
    const forged = await app.inject({ method: 'PUT', url: u.pathname + u.search, headers: { 'content-type': 'image/png' }, payload: await makeImage() });
    expect(forged.statusCode).toBe(403);

    const noFile = await call('POST', `/properties/${p.id}/media`, admin.accessToken, { type: 'IMAGE', key: ok.json().key, contentType: 'image/png' });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json().code).toBe('MEDIA_NOT_UPLOADED');

    // chave de outra empresa/imóvel não pode ser registrada
    const cross = await call('POST', `/properties/${p.id}/media`, admin.accessToken, { type: 'IMAGE', key: 'outra-empresa/properties/x/original/a.png', contentType: 'image/png' });
    expect(cross.json().code).toBe('MEDIA_KEY_INVALID');
  });

  it('arquivo corrompido vira FAILED com motivo e pode ser reprocessado apenas nesse estado', async () => {
    const p = await newProperty();
    const { confirm } = await uploadPhoto(app, admin.accessToken, p.id, { buffer: Buffer.from('isto não é uma imagem') });
    expect(confirm!.statusCode).toBe(201);
    expect(confirm!.json().status).toBe('FAILED');
    expect(confirm!.json().processingError).toBeTruthy();
    const again = await call('POST', `/media/${confirm!.json().id}/reprocess`, admin.accessToken);
    expect(again.json().status).toBe('FAILED'); // continua corrompido
    const good = await uploadPhoto(app, admin.accessToken, p.id);
    expect((await call('POST', `/media/${good.confirm!.json().id}/reprocess`, admin.accessToken)).statusCode).toBe(409);
  });
});

describe('galeria', () => {
  it('capa, ordenação e exclusão mantêm posições contínuas e promovem nova capa', async () => {
    const p = await newProperty();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await uploadPhoto(app, admin.accessToken, p.id)).confirm!.json().id);

    let list = (await call('GET', `/properties/${p.id}/media`, admin.accessToken)).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual(ids);
    expect(list.filter((m: { isCover: boolean }) => m.isCover).map((m: { id: string }) => m.id)).toEqual([ids[0]]);

    // definir outra capa move essa foto para a frente
    const setCover = await call('PATCH', `/media/${ids[1]}`, admin.accessToken, { isCover: true });
    expect(setCover.json().isCover).toBe(true);
    list = (await call('GET', `/properties/${p.id}/media`, admin.accessToken)).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual([ids[1], ids[0], ids[2]]);
    expect(list.filter((m: { isCover: boolean }) => m.isCover)).toHaveLength(1);

    // reordenar tentando tirar a capa da frente: a capa permanece primeira
    list = (await call('PATCH', `/properties/${p.id}/media/order`, admin.accessToken, { ids: [ids[2]!, ids[0]!, ids[1]!] })).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual([ids[1], ids[2], ids[0]]);
    const bad = await call('PATCH', `/properties/${p.id}/media/order`, admin.accessToken, { ids: [ids[0]] });
    expect(bad.json().code).toBe('MEDIA_ORDER_INVALID');

    // apaga a capa: a próxima foto vira capa, na frente, e as posições ficam 0..n-1
    expect((await call('DELETE', `/media/${ids[1]}`, admin.accessToken)).statusCode).toBe(204);
    list = (await call('GET', `/properties/${p.id}/media`, admin.accessToken)).json();
    expect(list.map((m: { position: number }) => m.position)).toEqual([0, 1]);
    expect(list[0].id).toBe(ids[2]);
    expect(list[0].isCover).toBe(true);
  });

  it('publicar exige ao menos uma foto', async () => {
    const p = await newProperty();
    const fail = await call('POST', `/properties/${p.id}/publish`, admin.accessToken);
    expect(fail.statusCode).toBe(422);
    expect(fail.json().details.map((d: { field: string }) => d.field)).toContain('media');
    await uploadPhoto(app, admin.accessToken, p.id);
    expect((await call('POST', `/properties/${p.id}/publish`, admin.accessToken)).statusCode).toBe(200);
  });
});

describe('isolamento e permissões', () => {
  it('empresa B não acessa mídia da empresa A; corretor envia mas não exclui', async () => {
    const p = await newProperty();
    const { confirm } = await uploadPhoto(app, admin.accessToken, p.id);
    const id = confirm!.json().id;

    expect((await call('GET', `/properties/${p.id}/media`, adminB.accessToken)).statusCode).toBe(404);
    expect((await call('POST', `/properties/${p.id}/media/upload-url`, adminB.accessToken, { type: 'IMAGE', filename: 'a.png', contentType: 'image/png', size: 10 })).statusCode).toBe(404);
    expect((await call('PATCH', `/media/${id}`, adminB.accessToken, { caption: 'x' })).statusCode).toBe(404);
    expect((await call('DELETE', `/media/${id}`, adminB.accessToken)).statusCode).toBe(404);

    const up = await uploadPhoto(app, broker.accessToken, p.id);
    expect(up.confirm!.statusCode).toBe(201); // corretor tem media.upload
    expect((await call('DELETE', `/media/${id}`, broker.accessToken)).statusCode).toBe(403); // sem media.delete
  });
});

// Fila real (BullMQ + Redis). Só roda quando TEST_REDIS_URL aponta para um Redis disponível.
describe.skipIf(!process.env.TEST_REDIS_URL)('fila BullMQ', () => {
  it('processa em segundo plano: confirma como PENDING e termina READY', async () => {
    const queued = await bootApp({ REDIS_URL: process.env.TEST_REDIS_URL! });
    try {
      const tk = (await login(queued, 'admin.a@teste.com')).body.accessToken;
      const p = (await queued.inject({ method: 'POST', url: '/api/v1/properties', headers: auth(tk), payload: { title: 'Fila', purpose: 'SALE', typeId, salePrice: 1 } })).json();
      const { confirm } = await uploadPhoto(queued, tk, p.id);
      expect(['PENDING', 'PROCESSING', 'READY']).toContain(confirm!.json().status);
      let status = confirm!.json().status;
      for (let i = 0; i < 40 && status !== 'READY'; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const list = (await queued.inject({ method: 'GET', url: `/api/v1/properties/${p.id}/media`, headers: auth(tk) })).json();
        status = list[0].status;
      }
      expect(status).toBe('READY');
    } finally {
      await queued.close();
    }
  });
});
