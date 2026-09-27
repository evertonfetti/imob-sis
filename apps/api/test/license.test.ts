import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env';
import { LicenseService } from '../src/license/license.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/** Bloco 11 (SaaS) — Fase 1: banco falso, só com o que o serviço usa. */
function fakePrisma(row: { fingerprint?: string | null; lastOkAt?: Date | null; createdAt?: Date }) {
  const state = { id: 'singleton', fingerprint: row.fingerprint ?? null, lastOkAt: row.lastOkAt ?? null, createdAt: row.createdAt ?? new Date() };
  return {
    licenseState: {
      upsert: vi.fn().mockResolvedValue({ ok: true, status: 'ACTIVE', planName: null, limits: {}, message: null }),
      findUnique: vi.fn().mockResolvedValue(state),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(state, data); return Promise.resolve(state); }),
    },
    user: { count: vi.fn().mockResolvedValue(0) },
    property: { count: vi.fn().mockResolvedValue(0) },
    branch: { count: vi.fn().mockResolvedValue(0) },
    socialAccount: { count: vi.fn().mockResolvedValue(0) },
    aiAccount: { count: vi.fn().mockResolvedValue(0) },
  } as unknown as PrismaService;
}

const env = (over: Partial<Env> = {}): Env => ({
  LICENSE_SERVER_URL: 'https://licencas.invalid', LICENSE_KEY: 'LIC-teste', LICENSE_CHECK_INTERVAL_MS: 999_999_999, LICENSE_GRACE_DAYS: 1,
  LICENSE_SUPPORT_CONTACT: 'suporte@teste.com', API_PUBLIC_URL: undefined, ...over,
} as unknown as Env);

describe('LicenseService', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('desativado (sem LICENSE_SERVER_URL/LICENSE_KEY): nunca bloqueia e não chama a rede', async () => {
    const svc = new LicenseService(env({ LICENSE_SERVER_URL: undefined }), fakePrisma({}));
    await svc.onModuleInit();
    expect(svc.isBlocked()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('confirmação bem-sucedida: libera o uso com os limites do plano', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: 'ACTIVE', ok: true, planKey: 'pro', planName: 'Pro', limits: { maxUsers: 10 }, message: null }), { status: 200 }));
    const svc = new LicenseService(env(), fakePrisma({}));
    await svc.onModuleInit();
    expect(svc.isBlocked()).toBe(false);
    expect(svc.getState()).toMatchObject({ ok: true, status: 'ACTIVE', planName: 'Pro' });
  });

  it('chave rejeitada (403, ex.: outra instalação já usa a mesma chave): bloqueia na hora, sem esperar o prazo de tolerância', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: 'LICENSE_FINGERPRINT_MISMATCH', message: 'Esta chave já está em uso por outra instalação.' }), { status: 403 }));
    const svc = new LicenseService(env(), fakePrisma({ lastOkAt: new Date() })); // confirmava certinho até agora
    await svc.onModuleInit();
    expect(svc.isBlocked()).toBe(true);
    expect(svc.getState().message).toMatch(/outra instalação/);
  });

  it('sem contato com o servidor, mas dentro do prazo de tolerância: continua liberado', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fetch failed'));
    const svc = new LicenseService(env({ LICENSE_GRACE_DAYS: 7 }), fakePrisma({ lastOkAt: new Date(Date.now() - 2 * 86_400_000) }));
    await svc.onModuleInit();
    expect(svc.isBlocked()).toBe(false);
  });

  it('sem contato além do prazo de tolerância: passa a bloquear', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('fetch failed'));
    const svc = new LicenseService(env({ LICENSE_GRACE_DAYS: 7 }), fakePrisma({ lastOkAt: new Date(Date.now() - 8 * 86_400_000) }));
    await svc.onModuleInit();
    expect(svc.isBlocked()).toBe(true);
    expect(svc.getState().message).toMatch(/suporte@teste.com/);
  });

  describe('Fase 3: limites do plano', () => {
    async function withLimits(limits: Record<string, unknown>) {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: 'ACTIVE', ok: true, planKey: 'x', planName: 'X', limits, message: null }), { status: 200 }));
      const svc = new LicenseService(env(), fakePrisma({}));
      await svc.onModuleInit();
      return svc;
    }

    it('sem limite definido para o recurso, nunca bloqueia', async () => {
      const svc = await withLimits({ maxUsers: 5 }); // maxSocialAccounts nem aparece
      expect(() => svc.assertLimit('maxSocialAccounts', 999)).not.toThrow();
    });

    it('bloqueia exatamente ao atingir o limite (e libera um a menos)', async () => {
      const svc = await withLimits({ maxSocialAccounts: 3 });
      expect(() => svc.assertLimit('maxSocialAccounts', 2)).not.toThrow(); // 3ª conta: cabe
      expect(() => svc.assertLimit('maxSocialAccounts', 3)).toThrow(); // 4ª conta: não cabe
    });

    it('lote (adding > 1): considera todas de uma vez, não uma por uma', async () => {
      const svc = await withLimits({ maxSocialAccounts: 5 });
      expect(() => svc.assertLimit('maxSocialAccounts', 3, 2)).not.toThrow(); // 3 existentes + 2 novas = 5: cabe
      expect(() => svc.assertLimit('maxSocialAccounts', 3, 3)).toThrow(); // 3 + 3 = 6: não cabe
    });

    it('recurso liga/desliga (aiAgent): ausente bloqueia, true libera', async () => {
      expect((await withLimits({})).hasFeature('aiAgent')).toBe(false);
      expect((await withLimits({ aiAgent: true })).hasFeature('aiAgent')).toBe(true);
    });

    it('sem licenciamento, nem limite nem recurso liga/desliga bloqueiam', async () => {
      const svc = new LicenseService(env({ LICENSE_SERVER_URL: undefined }), fakePrisma({}));
      await svc.onModuleInit();
      expect(() => svc.assertLimit('maxUsers', 999_999)).not.toThrow();
      expect(svc.hasFeature('aiAgent')).toBe(true);
    });
  });
});
