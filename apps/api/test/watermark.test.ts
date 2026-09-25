import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../src/storage/storage.service';
import { auth, bootApp, login, resetAndSeed, uploadPhoto } from './helpers';

let app: NestFastifyApplication;
let storage: StorageService;
const tk: Record<string, string> = {};
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');
let prop: { id: string };
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });

const GREY: [number, number, number] = [100, 100, 100];
const solid = (w: number, h: number, c: [number, number, number]) => sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toBuffer();
const pixel = async (buf: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
const near = (a: number[], b: number[], tol = 28) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const MAGENTA = [255, 0, 255];

async function uploadLogo(who: string, buffer: Buffer, contentType = 'image/png') {
  const t = await call('POST', '/company/logo/upload-url', who, { contentType, sizeBytes: buffer.length });
  if (t.statusCode !== 200) return { t, confirm: null };
  const { key, uploadUrl } = t.json();
  const u = new URL(uploadUrl);
  await app.inject({ method: 'PUT', url: u.pathname + u.search, headers: { 'content-type': contentType }, payload: buffer });
  return { t, key, confirm: await call('POST', '/company/logo', who, { key }) };
}
async function photo() {
  const r = await uploadPhoto(app, tk.admin!, prop.id, { buffer: await solid(1200, 800, GREY) });
  const id = r.confirm!.json().id as string;
  return { id, row: () => prisma.propertyMedia.findUniqueOrThrow({ where: { id } }) };
}
const processed = async (m: { row: () => Promise<{ processedKey: string | null }> }) => storage.read((await m.row()).processedKey!);
const thumb = async (m: { row: () => Promise<{ thumbnailKey: string | null }> }) => storage.read((await m.row()).thumbnailKey!);
const wm = () => call('GET', '/company/watermark', 'admin').then((r) => r.json());

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  storage = app.get(StorageService);
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  const typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
  prop = (await call('POST', '/properties', 'admin', { title: 'Casa marca d’água', purpose: 'SALE', typeId, salePrice: 700000, city: 'Campinas', neighborhood: 'Taquaral' })).json();
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('logo e marca d’água', () => {
  it('começa desligada; só quem administra a empresa mexe; valida faixas; não liga sem logo', async () => {
    expect(await wm()).toMatchObject({ settings: { enabled: false, position: 'BOTTOM_RIGHT', opacity: 70, scale: 18, margin: 3 }, hasLogo: false, logoUrl: null, outdatedPhotos: 0 });
    expect((await call('GET', '/company/watermark', 'broker')).statusCode).toBe(403);
    expect((await call('PATCH', '/company/watermark', 'broker', { enabled: true })).statusCode).toBe(403);
    expect((await call('POST', '/company/watermark/apply', 'broker')).statusCode).toBe(403);
    for (const bad of [{ opacity: 5 }, { opacity: 101 }, { scale: 90 }, { scale: 2 }, { margin: 20 }, { position: 'MEIO' }]) expect((await call('PATCH', '/company/watermark', 'admin', bad)).statusCode).toBe(400);
    expect((await call('PATCH', '/company/watermark', 'admin', { enabled: true })).json().code).toBe('LOGO_REQUIRED');
  });

  it('valida a logo: formato, tamanho mínimo, arquivo corrompido e chave de outra empresa', async () => {
    expect((await call('POST', '/company/logo/upload-url', 'admin', { contentType: 'image/gif', sizeBytes: 100 })).statusCode).toBe(400);
    expect((await call('POST', '/company/logo/upload-url', 'admin', { contentType: 'image/png', sizeBytes: 6 * 1024 * 1024 })).statusCode).toBe(400);
    expect((await uploadLogo('admin', await solid(20, 20, [255, 0, 255]))).confirm!.json().code).toBe('LOGO_INVALID'); // pequena demais
    expect((await uploadLogo('admin', Buffer.from('isso não é uma imagem'))).confirm!.json().code).toBe('LOGO_INVALID');
    expect((await call('POST', '/company/logo', 'admin', { key: 'qualquer-coisa-fora-do-fluxo' })).json().code).toBe('LOGO_INVALID');
    const t = (await call('POST', '/company/logo/upload-url', 'admin', { contentType: 'image/png', sizeBytes: 100 })).json();
    expect((await call('POST', '/company/logo', 'adminB', { key: t.key })).json().code).toBe('LOGO_INVALID'); // a chave é da empresa A
    expect((await wm()).hasLogo).toBe(false);
  });

  it('recebe logo em PNG ou SVG, guarda normalizada, expõe no site e troca apagando a anterior', async () => {
    const png = await uploadLogo('admin', await solid(300, 100, [255, 0, 255]));
    expect(png.confirm!.statusCode).toBe(200);
    const first = await wm();
    expect(first).toMatchObject({ hasLogo: true });
    expect(first.logoUrl).toMatch(/branding\/logo-/);
    const company = await prisma.company.findFirstOrThrow({ where: { logoKey: { not: null } } });
    expect(await storage.head(company.logoKey!)).not.toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/company' })).json().logoUrl).toBe(first.logoUrl); // o site usa a mesma logo

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#ff00ff"/></svg>');
    expect((await uploadLogo('admin', svg, 'image/svg+xml')).confirm!.statusCode).toBe(200);
    const second = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(second.logoKey).not.toBe(company.logoKey);
    expect(await storage.head(company.logoKey!)).toBeNull(); // logo anterior removida
    expect(second.watermarkRevision).toBeGreaterThan(company.watermarkRevision - 1);
    expect((await call('GET', '/company/watermark', 'adminB')).json()).toMatchObject({ hasLogo: false, logoUrl: null }); // cada empresa tem a sua
  });
});

describe('carimbo nas fotos', () => {
  it('foto nova sai carimbada (publicada e miniatura) e o original nunca recebe a marca; foto antiga só muda ao reaplicar', async () => {
    const before = await photo(); // enviada com a marca desligada
    expect(near(await pixel(await processed(before), 1000, 720), GREY)).toBe(true);

    expect((await call('PATCH', '/company/watermark', 'admin', { enabled: true, position: 'BOTTOM_RIGHT', opacity: 100, scale: 20, margin: 3 })).statusCode).toBe(200);
    expect((await wm()).outdatedPhotos).toBe(1); // a foto de antes ficou com a versão anterior

    const fresh = await photo();
    const p = await processed(fresh);
    expect(near(await pixel(p, 1000, 720), MAGENTA)).toBe(true); // dentro da logo (canto inferior direito)
    expect(near(await pixel(p, 100, 100), GREY)).toBe(true);     // fora da logo
    expect(near(await pixel(await thumb(fresh), 420, 330), MAGENTA)).toBe(true);
    expect(near(await pixel(await storage.read((await fresh.row()).originalKey), 1000, 720), GREY, 3)).toBe(true); // o original fica limpo
    expect((await fresh.row()).watermarkRevision).not.toBeNull();

    // a antiga continua sem marca até reaplicar
    expect(near(await pixel(await processed(before), 1000, 720), GREY)).toBe(true);
    const oldKey = (await before.row()).processedKey!;
    const r = await call('POST', '/company/watermark/apply', 'admin');
    expect(r.json().queued).toBe(1);
    expect(near(await pixel(await processed(before), 1000, 720), MAGENTA)).toBe(true);
    const newKey = (await before.row()).processedKey!;
    expect(newKey).not.toBe(oldKey); // chave nova: navegador e CDN não servem a foto antiga
    expect(await storage.head(oldKey)).toBeNull();
    expect((await before.row()).status).toBe('READY'); // nunca saiu do ar
    expect((await wm()).outdatedPhotos).toBe(0);
    expect((await call('POST', '/company/watermark/apply', 'admin')).json().queued).toBe(0); // idempotente
  });

  it('posição e opacidade valem para as fotos novas; mudar as regras marca as antigas como desatualizadas; a foto do Instagram é refeita', async () => {
    await call('PATCH', '/company/watermark', 'admin', { position: 'TOP_LEFT', opacity: 50 });
    const m = await photo();
    const p = await processed(m);
    const blended = await pixel(p, 100, 60); // dentro da logo, no canto superior esquerdo
    expect(near(blended, [177, 50, 177], 30)).toBe(true); // mistura de magenta e cinza a 50%
    expect(near(await pixel(p, 1000, 720), GREY)).toBe(true); // o canto antigo ficou livre
    expect((await wm()).outdatedPhotos).toBeGreaterThanOrEqual(1); // as demais ainda estão na posição anterior

    // a versão JPEG do Instagram é gerada a partir da foto carimbada e refeita quando a foto é reprocessada
    await prisma.propertyMedia.update({ where: { id: m.id }, data: { socialKey: 'x/social/velho.jpg' } });
    await call('PATCH', '/company/watermark', 'admin', { opacity: 60 }); // regra nova: a foto fica desatualizada
    await call('POST', '/company/watermark/apply', 'admin');
    expect((await m.row()).socialKey).toBeNull();
    expect((await wm()).outdatedPhotos).toBe(0);
  });

  it('a versão aprovada por IA também sai carimbada; desligar e reaplicar tira a marca; remover a logo desliga tudo', async () => {
    const m = await photo();
    const g = (await call('POST', `/media/${m.id}/generations`, 'admin', { operation: 'ENHANCE' })).json().generations[0]; // modo básico (local)
    expect(g.status).toBe('READY');
    await call('POST', `/generations/${g.id}/approve`, 'admin');
    expect((await m.row())).toMatchObject({ aiModified: true, renderedGenerationId: g.id });
    expect(near(await pixel(await processed(m), 100, 60), [177, 50, 177], 40)).toBe(true); // marca sobre a versão de IA

    await call('PATCH', '/company/watermark', 'admin', { enabled: false });
    expect((await wm()).outdatedPhotos).toBeGreaterThanOrEqual(1);
    await call('POST', '/company/watermark/apply', 'admin');
    expect(near(await pixel(await processed(m), 100, 60), GREY, 45)).toBe(true); // sem marca (a versão de IA foi mantida)
    expect((await m.row())).toMatchObject({ watermarkRevision: null, aiModified: true });
    expect((await wm()).outdatedPhotos).toBe(0);

    // ligar de novo e remover a logo: desliga a marca e deixa as fotos para reaplicar
    await call('PATCH', '/company/watermark', 'admin', { enabled: true });
    await call('POST', '/company/watermark/apply', 'admin');
    const logoKey = (await prisma.company.findFirstOrThrow({ where: { logoKey: { not: null } } })).logoKey!;
    const rm = await call('DELETE', '/company/logo', 'admin');
    expect(rm.json()).toMatchObject({ hasLogo: false, settings: { enabled: false } });
    expect(await storage.head(logoKey)).toBeNull();
    expect((await wm()).outdatedPhotos).toBeGreaterThanOrEqual(1); // fotos ainda carimbadas
    await call('POST', '/company/watermark/apply', 'admin');
    expect((await wm()).outdatedPhotos).toBe(0);
    expect((await call('PATCH', '/company/watermark', 'admin', { enabled: true })).json().code).toBe('LOGO_REQUIRED');
  });
});
