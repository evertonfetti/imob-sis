import type { PlanLimits } from '@imob/types';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LicenseService } from '../src/license/license.service';
import { auth, bootApp, login, resetAndSeed } from './helpers';

/**
 * Bloco 11 (SaaS) — Fase 3: limites do plano (via LicenseService) aplicados nos pontos reais do sistema
 * do cliente. A instalação finge estar licenciada (LICENSE_SERVER_URL/LICENSE_KEY) e o "servidor de
 * licenças" é só este stub de fetch — o que importa aqui é o bloqueio no lado do cliente, já coberto
 * ponta a ponta no license-api para o próprio servidor.
 */
let app: NestFastifyApplication;
const tk: Record<string, string> = {};
let typeId: string;
let limits: PlanLimits = {};

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });

function fakeFetch() {
  return Promise.resolve(new Response(JSON.stringify({
    status: 'ACTIVE', ok: true, planKey: 'teste', planName: 'Plano de teste', limits, message: null,
    currentPeriodEnd: null, trialEndsAt: null, checkAgainInSeconds: 999_999,
  }), { status: 200 }));
}

beforeAll(async () => {
  await resetAndSeed();
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  app = await bootApp({ LICENSE_SERVER_URL: 'https://licencas.teste', LICENSE_KEY: 'chave-de-teste', LICENSE_CHECK_INTERVAL_MS: '999999999' });
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  const types = (await call('GET', '/property-types', 'admin')).json();
  typeId = types.find((t: { name: string }) => t.name === 'Apartamento').id;
});
afterAll(() => app.close());
afterEach(() => { limits = {}; });

/** Aplica novos limites e força uma nova confirmação (em produção isso rodaria sozinho a cada poucas horas). */
async function setLimits(next: PlanLimits) {
  limits = next;
  await app.get(LicenseService).check();
}
const newProperty = () => ({ title: 'Apartamento no Centro', purpose: 'SALE', typeId, salePrice: 500_000, city: 'São Paulo', neighborhood: 'Centro', bedrooms: 2 });

describe('limites do plano (licenciamento — Fase 3)', () => {
  it('sem licenciamento configurado, nenhum limite se aplica (comportamento das instalações não revendidas)', async () => {
    await app.get(LicenseService).check(); // ainda sem limites nenhum
    expect((await call('POST', '/properties', 'admin', newProperty())).statusCode).toBe(201);
  });

  it('usuários: bloqueia criar acima do limite, com o motivo explicado', async () => {
    // A empresa seed já tem 2 usuários ativos (admin e corretor).
    await setLimits({ maxUsers: 2 });
    const blocked = await call('POST', '/users', 'admin', { name: 'Mais um', email: 'maisum@teste.com', roleKey: 'BROKER', password: 'Senha@12345' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'LICENSE_LIMIT_REACHED' });
    expect(blocked.json().message).toMatch(/2 usuários/);

    await setLimits({ maxUsers: 3 });
    expect((await call('POST', '/users', 'admin', { name: 'Mais um', email: 'maisum2@teste.com', roleKey: 'BROKER', password: 'Senha@12345' })).statusCode).toBe(201);
  });

  it('imóveis: bloqueia cadastrar o próximo acima do limite', async () => {
    const before = (await call('GET', '/properties?pageSize=1', 'admin')).json().total;
    await setLimits({ maxProperties: before + 1 }); // cabe mais um, mas não dois
    expect((await call('POST', '/properties', 'admin', newProperty())).statusCode).toBe(201);
    const blocked = await call('POST', '/properties', 'admin', newProperty());
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('LICENSE_LIMIT_REACHED');
  });

  it('agente de atendimento por IA: plano sem o recurso não deixa ativar', async () => {
    await setLimits({}); // aiAgent ausente = não incluído
    const blocked = await call('PUT', '/agent/settings', 'admin', { enabled: true });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('LICENSE_LIMIT_REACHED');

    await setLimits({ aiAgent: true });
    // Sem modelo escolhido ainda o erro é outro (validação normal, não a licença).
    expect((await call('PUT', '/agent/settings', 'admin', { enabled: true })).json().code).toBe('AGENT_MODEL_REQUIRED');
  });
});
