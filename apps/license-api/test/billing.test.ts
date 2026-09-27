import { createPrismaClient } from '@imob/license-database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/billing/billing.service';
import { mpManifest } from '../src/billing/signature';
import { auth, bootApp, login, resetAndSeed } from './helpers';

let app: NestFastifyApplication;
let token: string;
const prisma = createPrismaClient(process.env.TEST_LICENSE_DATABASE_URL ?? '');
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/v1${url}`, headers: auth(token), payload: payload as never });

const SECRET = 'segredo-de-teste-mercadopago';

/** Simula a API do Mercado Pago: cria preferências e devolve pagamentos conforme configurado no teste. */
let paymentByExternalRef: Map<string, { status: string; amountCents: number }>;
function fakeFetch(input: string | URL, init?: RequestInit) {
  const url = String(input);
  if (url.includes('/checkout/preferences')) {
    const body = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({ id: `pref_${body.external_reference}`, init_point: `https://mp.example/checkout/${body.external_reference}` }), { status: 201 }));
  }
  if (url.includes('/v1/payments/')) {
    const paymentId = url.split('/').pop()!;
    const entry = paymentByExternalRef.get(paymentId);
    return Promise.resolve(new Response(JSON.stringify({ id: Number(paymentId.replace(/\D/g, '')) || 1, status: entry?.status ?? 'approved', external_reference: paymentId, transaction_amount: (entry?.amountCents ?? 0) / 100 }), { status: 200 }));
  }
  return Promise.reject(new Error(`URL não esperada no teste: ${url}`));
}

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp({ MP_ACCESS_TOKEN: 'token-de-teste', MP_WEBHOOK_SECRET: SECRET, LICENSE_API_PUBLIC_URL: 'https://licencas-api.teste', BILLING_ADVANCE_DAYS: '5', BILLING_GRACE_DAYS: '5' });
  token = (await login(app, 'staff@teste.com')).body.accessToken;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(() => { paymentByExternalRef = new Map(); vi.stubGlobal('fetch', vi.fn(fakeFetch)); });
afterEach(() => vi.unstubAllGlobals());

async function planClientLicense(priceCents: number, trialDays = 0) {
  const plan = (await call('POST', '/plans', { key: `p-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: 'Plano', priceCents, billingInterval: 'MONTHLY', limits: {} })).json();
  const client = (await call('POST', '/clients', { name: 'Cliente' })).json();
  const license = (await call('POST', '/licenses', { clientId: client.id, planId: plan.id, trialDays })).json();
  return { plan, client, license };
}

/** Webhook assinado de verdade, com a mesma conta HMAC que o servidor confere (documentação oficial do Mercado Pago). */
async function sendWebhook(dataId: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = 'req-1';
  const manifest = mpManifest(dataId, requestId, ts);
  const { createHmac } = await import('node:crypto');
  const v1 = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return app.inject({ method: 'POST', url: `/webhooks/mercadopago?data.id=${dataId}`, headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId } });
}

describe('cobrança (Mercado Pago)', () => {
  it('gera a fatura e devolve o link de pagamento', async () => {
    const { license } = await planClientLicense(9900);
    const r = await call('POST', `/licenses/${license.id}/invoices`);
    expect(r.statusCode).toBe(201);
    const inv = r.json();
    expect(inv.status).toBe('PENDING');
    expect(inv.amountCents).toBe(9900);
    expect(inv.checkoutUrl).toContain('mp.example/checkout/');
  });

  it('recusa gerar fatura de plano gratuito', async () => {
    const { license } = await planClientLicense(0);
    const r = await call('POST', `/licenses/${license.id}/invoices`);
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('BILLING_PLAN_FREE');
  });

  it('recusa segunda fatura enquanto a primeira está em aberto', async () => {
    const { license } = await planClientLicense(9900);
    expect((await call('POST', `/licenses/${license.id}/invoices`)).statusCode).toBe(201);
    const second = await call('POST', `/licenses/${license.id}/invoices`);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('BILLING_INVOICE_OPEN');
  });

  it('webhook com assinatura errada é recusado', async () => {
    const r = await app.inject({ method: 'POST', url: '/webhooks/mercadopago?data.id=999', headers: { 'x-signature': 'ts=123,v1=deadbeef', 'x-request-id': 'x' } });
    expect(r.statusCode).toBe(401);
  });

  it('pagamento aprovado ativa a licença e estende o período; notificação repetida não some duplicada', async () => {
    const { license, plan } = await planClientLicense(9900);
    const inv = (await call('POST', `/licenses/${license.id}/invoices`)).json();
    paymentByExternalRef.set(inv.id, { status: 'approved', amountCents: plan.priceCents });

    const first = await sendWebhook(inv.id);
    expect(first.statusCode).toBe(200);

    const updated = (await call('GET', `/licenses/${license.id}`)).json();
    expect(updated.status).toBe('ACTIVE');
    expect(new Date(updated.currentPeriodEnd).getTime()).toBe(new Date(inv.periodEnd).getTime());
    expect(updated.invoices[0].status).toBe('PAID');

    // Reenvio da mesma notificação (comum no Mercado Pago): não deve gerar um segundo evento de pagamento.
    await sendWebhook(inv.id);
    const events = (await call('GET', `/licenses/${license.id}`)).json().events;
    expect(events.filter((e: { type: string }) => e.type === 'payment_received')).toHaveLength(1);
  });

  it('pagamento pendente/rejeitado não altera a licença', async () => {
    const { license, plan } = await planClientLicense(9900);
    const inv = (await call('POST', `/licenses/${license.id}/invoices`)).json();
    paymentByExternalRef.set(inv.id, { status: 'rejected', amountCents: plan.priceCents });
    await sendWebhook(inv.id);
    const updated = (await call('GET', `/licenses/${license.id}`)).json();
    expect(updated.status).toBe('TRIALING');
    expect(updated.invoices[0].status).toBe('PENDING');
  });

  it('agendador: gera fatura perto do fim do teste e suspende quando vence sem pagar (respeitando o prazo de tolerância)', async () => {
    const { license } = await planClientLicense(9900, 3); // 3 dias de teste, aviso é de 5 dias antes → já entra na janela
    const svc = app.get(BillingService);
    await svc.tick();

    let inv = (await call('GET', `/licenses/${license.id}`)).json().invoices[0];
    expect(inv).toBeTruthy();
    expect(inv.status).toBe('PENDING');

    // Adianta o vencimento para o passado, além do prazo de tolerância, e roda a rotina de novo.
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(Date.now() - 10 * 86_400_000) } });
    await svc.tick();

    const after = (await call('GET', `/licenses/${license.id}`)).json();
    expect(after.status).toBe('SUSPENDED');
    expect(after.invoices[0].status).toBe('EXPIRED');
  });

  it('licença em modo manual não recebe fatura nem suspensão automática', async () => {
    const { license } = await planClientLicense(9900, 3);
    await call('PATCH', `/licenses/${license.id}/billing-mode`, { billingMode: 'MANUAL' });
    const svc = app.get(BillingService);
    await svc.tick();
    const after = (await call('GET', `/licenses/${license.id}`)).json();
    expect(after.invoices).toHaveLength(0);
    expect(after.status).toBe('TRIALING');
  });
});
