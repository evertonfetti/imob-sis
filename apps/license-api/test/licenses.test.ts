import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, login, resetAndSeed } from './helpers';

let app: NestFastifyApplication;
let token: string;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/v1${url}`, headers: auth(token), payload: payload as never });

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  token = (await login(app, 'staff@teste.com')).body.accessToken;
});
afterAll(() => app.close());

describe('licenças', () => {
  it('rejeita login com senha errada', async () => {
    const r = await login(app, 'staff@teste.com');
    expect(r.status).toBe(200); // sanity: reautentica sem problema
    const wrong = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'staff@teste.com', password: 'errada123' } });
    expect(wrong.statusCode).toBe(401);
  });

  it('cria plano, cliente e licença; a chave só aparece na criação', async () => {
    const plan = await call('POST', '/plans', {
      key: 'starter', name: 'Starter', priceCents: 9900, billingInterval: 'MONTHLY', limits: { maxUsers: 5, maxProperties: 200 },
    });
    expect(plan.statusCode).toBe(201);
    const client = await call('POST', '/clients', { name: 'Imobiliária Teste' });
    expect(client.statusCode).toBe(201);

    const lic = await call('POST', '/licenses', { clientId: client.json().id, planId: plan.json().id, trialDays: 14 });
    expect(lic.statusCode).toBe(201);
    const body = lic.json();
    expect(body.key).toMatch(/^LIC-/);
    expect(body.status).toBe('TRIALING');

    const detail = await call('GET', `/licenses/${body.id}`);
    expect(detail.json().key).toBeUndefined(); // depois da criação, só o preview
    expect(detail.json().keyPreview).toBe(body.key.slice(-4));
  });

  it('heartbeat: aceita a chave, fixa a instalação e bloqueia uma segunda instalação com a mesma chave', async () => {
    const plan = (await call('POST', '/plans', { key: 'pro', name: 'Pro', priceCents: 19900, billingInterval: 'MONTHLY', limits: {} })).json();
    const client = (await call('POST', '/clients', { name: 'Cliente Pro' })).json();
    const { key, id } = (await call('POST', '/licenses', { clientId: client.id, planId: plan.id })).json();

    const beat = (fingerprint: string) => app.inject({ method: 'POST', url: '/v1/licenses/heartbeat', headers: { 'x-license-key': key }, payload: { instanceFingerprint: fingerprint, counts: { users: 3 } } });

    const first = await beat('fingerprint-vps-1');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'TRIALING', ok: true, planKey: 'pro' });

    const second = await beat('fingerprint-vps-2');
    expect(second.statusCode).toBe(403);
    expect(second.json().code).toBe('LICENSE_FINGERPRINT_MISMATCH');

    // Chave errada nunca autentica.
    const bad = await app.inject({ method: 'POST', url: '/v1/licenses/heartbeat', headers: { 'x-license-key': 'LIC-inexistente' }, payload: { instanceFingerprint: 'fingerprint-x', counts: {} } });
    expect(bad.statusCode).toBe(401);

    // Suspender bloqueia o próximo heartbeat (a instalação do cliente trata isso como licença inválida).
    await call('PATCH', `/licenses/${id}/status`, { status: 'SUSPENDED', reason: 'Inadimplência' });
    const third = await beat('fingerprint-vps-1');
    expect(third.json()).toMatchObject({ status: 'SUSPENDED', ok: false, message: 'Inadimplência' });

    // Depois de resetar o vínculo, uma nova instalação pode se fixar.
    await call('PATCH', `/licenses/${id}/status`, { status: 'ACTIVE' });
    await call('POST', `/licenses/${id}/reset-fingerprint`);
    const migrated = await beat('fingerprint-vps-2');
    expect(migrated.statusCode).toBe(200);
    expect(migrated.json().ok).toBe(true);
  });
});
