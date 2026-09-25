import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProposalsService } from '../src/commercial/proposals.service';
import { auth, bootApp, login, resetAndSeed, uploadPhoto } from './helpers';

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
const ids: Record<string, string> = {};
let typeId: string;
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });
let seq = 0;
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const inDays = (d: number) => inMin(d * 24 * 60);

async function property(over: Record<string, unknown> = {}) {
  const p = (await call('POST', '/properties', 'admin', {
    title: 'Casa comercial', purpose: 'SALE', typeId, salePrice: 800000, minimumNegotiationPrice: 700000, city: 'Campinas', neighborhood: 'Cambuí', bedrooms: 3, ...over,
  })).json();
  await uploadPhoto(app, tk.admin!, p.id);
  await call('POST', `/properties/${p.id}/publish`, 'admin');
  return p as { id: string; code: string };
}
async function lead(who: string, propertyId?: string) {
  const n = ++seq;
  const r = await call('POST', '/leads', who, { customer: { name: `Comprador ${n}`, phone: `1191000${String(n).padStart(4, '0')}` }, ...(propertyId && { propertyId }) });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string };
}
const detail = async (id: string, who = 'admin') => (await call('GET', `/leads/${id}`, who)).json();
const stageOf = async (id: string) => (await detail(id)).stage.name as string;
const tasksOf = async (id: string) => (await prisma.task.findMany({ where: { leadId: id }, orderBy: { createdAt: 'asc' } }));
const propStatus = async (id: string) => (await call('GET', `/properties/${id}`, 'admin')).json().status as string;

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  ids.broker = (await call('GET', '/auth/me', 'broker')).json().id;
  ids.admin = (await call('GET', '/auth/me', 'admin')).json().id;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
  const r = await call('POST', '/users', 'admin', { name: 'Corretor Dois', email: 'corretor.dois@teste.com', roleKey: 'BROKER', password: 'Senha@12345' });
  ids.broker2 = r.json().id;
  tk.broker2 = (await login(app, 'corretor.dois@teste.com')).body.accessToken;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('visitas', () => {
  it('agenda: leva o lead a "Visita agendada", registra timeline e cria a tarefa de confirmação; bloqueia conflito e passado', async () => {
    const p = await property();
    const l = await lead('admin', p.id);
    const start = inDays(3);
    const r = await call('POST', '/visits', 'admin', { leadId: l.id, brokerId: ids.broker, scheduledAt: start, durationMinutes: 60 });
    expect(r.statusCode).toBe(201);
    const v = r.json();
    expect(await stageOf(l.id)).toBe('Visita agendada');
    const d = await detail(l.id);
    expect(d.timeline.map((t: { type: string }) => t.type)).toContain('VISIT_CREATED');
    const task = (await tasksOf(l.id)).find((t) => t.ref === `visit:${v.id}:confirm`)!;
    expect(task).toMatchObject({ status: 'OPEN', assignedUserId: ids.broker, type: 'VISIT' });
    expect(task.dueAt!.getTime()).toBeLessThan(new Date(start).getTime()); // lembrete antes da visita

    // mesmo corretor, horário sobreposto → conflito com detalhes; "force" permite
    const l2 = await lead('admin', p.id);
    const clash = await call('POST', '/visits', 'admin', { leadId: l2.id, brokerId: ids.broker, scheduledAt: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(), durationMinutes: 60 });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('VISIT_CONFLICT');
    expect(clash.json().details[0].id).toBe(v.id);
    // encostar no fim da anterior não é conflito
    expect((await call('POST', '/visits', 'admin', { leadId: l2.id, brokerId: ids.broker, scheduledAt: new Date(new Date(start).getTime() + 60 * 60_000).toISOString(), durationMinutes: 30 })).statusCode).toBe(201);
    expect((await call('POST', '/visits', 'admin', { leadId: l2.id, brokerId: ids.broker, scheduledAt: start, durationMinutes: 60, force: true })).statusCode).toBe(201);

    expect((await call('POST', '/visits', 'admin', { leadId: l.id, brokerId: ids.broker, scheduledAt: inMin(-180) })).json().code).toBe('VISIT_PAST');
    expect((await call('POST', '/visits', 'admin', { leadId: l.id })).statusCode).toBe(400);
  });

  it('respeita escopo: corretor só vê/agenda os próprios leads e só para si; outra empresa não enxerga nada', async () => {
    const pb = await property({ brokerId: ids.broker });
    const mine = await lead('broker', pb.id);
    const other = await lead('admin', (await property()).id); // lead do admin, sem corretor
    expect((await call('POST', '/visits', 'broker', { leadId: other.id, scheduledAt: inDays(4) })).statusCode).toBe(404);
    expect((await call('POST', '/visits', 'broker', { leadId: mine.id, brokerId: ids.broker2, scheduledAt: inDays(4) })).statusCode).toBe(403);
    const ok = await call('POST', '/visits', 'broker', { leadId: mine.id, scheduledAt: inDays(4) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().brokerId).toBe(ids.broker);

    // corretor 2 não vê visitas de outro corretor; admin vê
    expect((await call('GET', '/visits', 'broker2')).json().items.some((v: { id: string }) => v.id === ok.json().id)).toBe(false);
    expect((await call('GET', `/visits/${ok.json().id}`, 'broker2')).statusCode).toBe(404);
    expect((await call('GET', '/visits', 'admin')).json().items.some((v: { id: string }) => v.id === ok.json().id)).toBe(true);
    // multi-tenant
    expect((await call('GET', `/visits/${ok.json().id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('GET', '/visits', 'adminB')).json().items).toHaveLength(0);
    expect((await call('PATCH', `/visits/${ok.json().id}`, 'adminB', { notes: 'x' })).statusCode).toBe(404);
  });

  it('ciclo de vida: não conclui visita futura; conclui perto do horário (lead vai a "Visita realizada" + follow-up); estados finais são imutáveis', async () => {
    const p = await property();
    const l = await lead('admin', p.id);
    const future = (await call('POST', '/visits', 'admin', { leadId: l.id, brokerId: ids.broker, scheduledAt: inDays(9) })).json();
    expect((await call('PATCH', `/visits/${future.id}`, 'admin', { status: 'COMPLETED' })).json().code).toBe('VISIT_STATUS_INVALID');
    expect((await call('PATCH', `/visits/${future.id}`, 'admin', { status: 'NO_SHOW' })).statusCode).toBe(409);

    // confirmar → se o horário mudar, volta a "agendada"
    expect((await call('PATCH', `/visits/${future.id}`, 'admin', { status: 'CONFIRMED' })).json().status).toBe('CONFIRMED');
    const moved = (await call('PATCH', `/visits/${future.id}`, 'admin', { scheduledAt: inDays(10) })).json();
    expect(moved).toMatchObject({ status: 'SCHEDULED', confirmedAt: null });
    const t1 = (await tasksOf(l.id)).filter((t) => t.ref === `visit:${future.id}:confirm`);
    expect(t1.map((t) => t.status)).toEqual(['CANCELLED', 'OPEN']); // a tarefa antiga sai, entra a nova

    // visita que acontece agora
    const l2 = await lead('admin', p.id);
    const soon = (await call('POST', '/visits', 'admin', { leadId: l2.id, brokerId: ids.broker2, scheduledAt: inMin(10) })).json();
    const done = await call('PATCH', `/visits/${soon.id}`, 'admin', { status: 'COMPLETED', feedback: 'Gostou da cozinha, achou o valor alto.' });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: 'COMPLETED', feedback: 'Gostou da cozinha, achou o valor alto.' });
    expect(await stageOf(l2.id)).toBe('Visita realizada');
    const ts = await tasksOf(l2.id);
    expect(ts.find((t) => t.ref === `visit:${soon.id}:followup`)).toMatchObject({ status: 'OPEN', assignedUserId: ids.broker2, priority: 'HIGH' });
    // depois de realizada: só notas/feedback
    expect((await call('PATCH', `/visits/${soon.id}`, 'admin', { scheduledAt: inDays(5) })).statusCode).toBe(409);
    expect((await call('PATCH', `/visits/${soon.id}`, 'admin', { status: 'CANCELLED' })).statusCode).toBe(409);
    expect((await call('PATCH', `/visits/${soon.id}`, 'admin', { feedback: 'Vai pensar e voltar na semana que vem.' })).statusCode).toBe(200);

    // cancelamento e não comparecimento: tarefa de reagendar; nunca volta atrás
    const cancel = await call('PATCH', `/visits/${future.id}`, 'admin', { status: 'CANCELLED', cancelReason: 'Cliente viajou' });
    expect(cancel.json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cliente viajou' });
    const ts2 = await tasksOf(l.id);
    expect(ts2.filter((t) => t.ref === `visit:${future.id}:confirm` && t.status === 'OPEN')).toHaveLength(0);
    expect(ts2.find((t) => t.ref === `visit:${future.id}:reschedule`)).toMatchObject({ status: 'OPEN' });
    expect((await call('PATCH', `/visits/${future.id}`, 'admin', { status: 'CONFIRMED' })).statusCode).toBe(409);
    expect((await detail(l.id)).timeline.map((t: { type: string }) => t.type)).toContain('VISIT_CANCELLED');
  });

  it('a etapa do funil nunca retrocede: agendar nova visita em lead já em "Negociação" não o move para trás', async () => {
    const p = await property();
    const l = await lead('admin', p.id);
    const stages = (await call('GET', '/pipeline', 'admin')).json().stages as { id: string; name: string }[];
    await call('POST', `/leads/${l.id}/change-stage`, 'admin', { stageId: stages.find((s) => s.name === 'Negociação')!.id });
    expect((await call('POST', '/visits', 'admin', { leadId: l.id, brokerId: ids.broker, scheduledAt: inDays(12) })).statusCode).toBe(201);
    expect(await stageOf(l.id)).toBe('Negociação');
  });
});

describe('propostas', () => {
  it('cria com valor pedido do imóvel, valida entrada/financiamento, sinaliza valor abaixo do mínimo e leva o lead a "Proposta"', async () => {
    const p = await property({ brokerId: ids.broker });
    const l = await lead('broker', p.id);
    expect((await call('POST', '/proposals', 'broker', { leadId: l.id, proposedPrice: 700000, downPayment: 900000 })).json().code).toBe('PROPOSAL_PRICE_INVALID');
    expect((await call('POST', '/proposals', 'broker', { leadId: l.id, proposedPrice: 0 })).statusCode).toBe(400);
    expect((await call('POST', '/proposals', 'broker', { leadId: l.id, proposedPrice: 700000, validUntil: inDays(-1) })).statusCode).toBe(400);

    const draft = await call('POST', '/proposals', 'broker', { leadId: l.id, proposedPrice: 720000, downPayment: 200000, financingAmount: 520000, send: false });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ status: 'DRAFT', askingPrice: 800000, proposedPrice: 720000 });
    expect(await stageOf(l.id)).toBe('Novo'); // rascunho não move o funil

    // rascunho não aceita contraproposta; envio leva o lead à etapa
    expect((await call('POST', `/proposals/${draft.json().id}/counter`, 'broker', { amount: 730000, party: 'OWNER' })).statusCode).toBe(409);
    const sent = await call('PATCH', `/proposals/${draft.json().id}`, 'broker', { status: 'SENT' });
    expect(sent.json().status).toBe('SENT');
    expect(await stageOf(l.id)).toBe('Proposta');
    expect(sent.json().differencePct).toBeCloseTo(-0.1, 5);

    // mesmo critério do imóvel: mínimo e proprietário aparecem para quem edita imóveis (corretor e admin)
    expect(sent.json()).toMatchObject({ minimumNegotiationPrice: 700000, belowMinimum: false });
    expect(sent.json()).toHaveProperty('owner');
    const adminView = (await call('GET', `/proposals/${draft.json().id}`, 'admin')).json();
    expect(adminView).toMatchObject({ minimumNegotiationPrice: 700000, belowMinimum: false });
    const low = await call('POST', '/proposals', 'admin', { leadId: (await lead('admin', p.id)).id, proposedPrice: 650000 });
    expect(low.json().belowMinimum).toBe(true);
  });

  it('negociação: contrapropostas guardam o histórico, atualizam o valor e o status; ninguém mexe em proposta de outro escopo/empresa', async () => {
    const p = await property({ brokerId: ids.broker });
    const l = await lead('broker', p.id);
    const prop = (await call('POST', '/proposals', 'broker', { leadId: l.id, proposedPrice: 650000 })).json();
    const c1 = await call('POST', `/proposals/${prop.id}/counter`, 'broker', { amount: 780000, party: 'OWNER', note: 'Só fecha acima de 780 mil' });
    expect(c1.json()).toMatchObject({ status: 'COUNTERED', proposedPrice: 780000 });
    const c2 = await call('POST', `/proposals/${prop.id}/counter`, 'broker', { amount: 730000, party: 'BUYER', conditions: 'Pagamento à vista' });
    expect(c2.json()).toMatchObject({ status: 'UNDER_REVIEW', proposedPrice: 730000, conditions: 'Pagamento à vista' });
    expect(c2.json().revisions.map((r: { party: string; amount: number }) => [r.party, r.amount])).toEqual([['BUYER', 650000], ['OWNER', 780000], ['BUYER', 730000]]);
    expect(await stageOf(l.id)).toBe('Negociação');
    expect((await detail(l.id)).timeline.filter((t: { type: string }) => t.type === 'PROPOSAL_UPDATED').length).toBeGreaterThanOrEqual(2);

    expect((await call('GET', `/proposals/${prop.id}`, 'broker2')).statusCode).toBe(404);
    expect((await call('POST', `/proposals/${prop.id}/counter`, 'broker2', { amount: 1, party: 'OWNER' })).statusCode).toBe(404);
    expect((await call('GET', `/proposals/${prop.id}`, 'adminB')).statusCode).toBe(404);
    expect((await call('GET', '/proposals', 'broker2')).json().total).toBe(0);
  });

  it('decidir exige "proposal.manage"; aceitar reserva o imóvel; cancelar a aceita o libera; transições inválidas são recusadas', async () => {
    const p = await property({ brokerId: ids.broker });
    const l = await lead('broker', p.id);
    const prop = (await call('POST', '/proposals', 'broker', { leadId: l.id, proposedPrice: 760000 })).json();
    expect((await call('PATCH', `/proposals/${prop.id}`, 'broker', { status: 'ACCEPTED' })).statusCode).toBe(403);
    expect((await call('PATCH', `/proposals/${prop.id}`, 'broker', { status: 'EXPIRED' })).statusCode).toBe(409);
    expect((await call('PATCH', `/proposals/${prop.id}`, 'admin', { status: 'DRAFT' })).statusCode).toBe(409);

    const acc = await call('PATCH', `/proposals/${prop.id}`, 'admin', { status: 'ACCEPTED' });
    expect(acc.json().status).toBe('ACCEPTED');
    expect(await propStatus(p.id)).toBe('RESERVED');
    expect(await stageOf(l.id)).toBe('Negociação');
    // aceita não recebe contraproposta nem edição de valores por corretor
    expect((await call('POST', `/proposals/${prop.id}/counter`, 'admin', { amount: 700000, party: 'OWNER' })).statusCode).toBe(409);

    // desfazer a aceitação libera o imóvel
    expect((await call('PATCH', `/proposals/${prop.id}`, 'admin', { status: 'CANCELLED' })).json().status).toBe('CANCELLED');
    expect(await propStatus(p.id)).toBe('AVAILABLE');
    expect((await call('PATCH', `/proposals/${prop.id}`, 'admin', { status: 'SENT' })).json().code).toBe('PROPOSAL_CLOSED');
  });

  it('fechar o negócio: imóvel vendido, lead ganho, outras propostas do imóvel canceladas; não fecha sem aceite; imóvel vendido não recebe novas propostas nem visitas', async () => {
    const p = await property();
    const l1 = await lead('admin', p.id);
    const l2 = await lead('admin', p.id);
    const win = (await call('POST', '/proposals', 'admin', { leadId: l1.id, proposedPrice: 790000 })).json();
    const lose = (await call('POST', '/proposals', 'admin', { leadId: l2.id, proposedPrice: 700000 })).json();

    expect((await call('POST', `/proposals/${win.id}/close`, 'admin')).json().code).toBe('PROPOSAL_NOT_ACCEPTED');
    await call('PATCH', `/proposals/${win.id}`, 'admin', { status: 'ACCEPTED' });
    expect((await call('POST', `/proposals/${win.id}/close`, 'broker')).statusCode).toBe(403);
    const closed = await call('POST', `/proposals/${win.id}/close`, 'admin');
    expect(closed.statusCode).toBe(200);
    expect(await propStatus(p.id)).toBe('SOLD');
    expect(await stageOf(l1.id)).toBe('Fechado');
    expect((await call('GET', `/proposals/${lose.id}`, 'admin')).json().status).toBe('CANCELLED');
    expect((await detail(l2.id)).timeline.some((t: { title: string }) => t.title === 'Proposta cancelada')).toBe(true);

    expect((await call('POST', '/proposals', 'admin', { leadId: l2.id, proposedPrice: 500000 })).json().code).toBe('PROPOSAL_PROPERTY_UNAVAILABLE');
    expect((await call('POST', '/visits', 'admin', { leadId: l2.id, scheduledAt: inDays(2) })).json().code).toBe('VISIT_PROPERTY_UNAVAILABLE');
    const audit = await prisma.auditLog.findMany({ where: { entityId: win.id } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'STATUS_ACCEPTED', 'CLOSE_DEAL']));
  });

  it('aluguel fecha como "Alugado"', async () => {
    const p = await property({ purpose: 'RENT', salePrice: undefined, rentPrice: 4500, minimumNegotiationPrice: undefined });
    const l = await lead('admin', p.id);
    const prop = (await call('POST', '/proposals', 'admin', { leadId: l.id, proposedPrice: 4200 })).json();
    expect(prop.askingPrice).toBe(4500);
    await call('PATCH', `/proposals/${prop.id}`, 'admin', { status: 'ACCEPTED' });
    await call('POST', `/proposals/${prop.id}/close`, 'admin');
    expect(await propStatus(p.id)).toBe('RENTED');
  });

  it('expira propostas em aberto com validade vencida (e só elas), registrando na timeline', async () => {
    const p = await property();
    const la = await lead('admin', p.id);
    const lb = await lead('admin', p.id);
    const lc = await lead('admin', p.id);
    const due = (await call('POST', '/proposals', 'admin', { leadId: la.id, proposedPrice: 700000, validUntil: inMin(60) })).json();
    const fine = (await call('POST', '/proposals', 'admin', { leadId: lb.id, proposedPrice: 700000, validUntil: inDays(5) })).json();
    const accepted = (await call('POST', '/proposals', 'admin', { leadId: lc.id, proposedPrice: 700000, validUntil: inMin(60) })).json();
    await call('PATCH', `/proposals/${accepted.id}`, 'admin', { status: 'ACCEPTED' });

    const svc = app.get(ProposalsService);
    expect(await svc.expireDue(new Date())).toBe(0);
    expect(await svc.expireDue(new Date(Date.now() + 2 * 3_600_000))).toBe(1);
    expect((await call('GET', `/proposals/${due.id}`, 'admin')).json().status).toBe('EXPIRED');
    expect((await call('GET', `/proposals/${fine.id}`, 'admin')).json().status).toBe('SENT');
    expect((await call('GET', `/proposals/${accepted.id}`, 'admin')).json().status).toBe('ACCEPTED'); // aceita não expira
    expect((await detail(la.id)).timeline.some((t: { title: string }) => t.title === 'Proposta expirada')).toBe(true);
    expect(await svc.expireDue(new Date(Date.now() + 2 * 3_600_000))).toBe(0); // idempotente
  });
});

describe('painel comercial', () => {
  it('resume visitas e propostas respeitando o escopo', async () => {
    const a = (await call('GET', '/commercial/summary', 'admin')).json();
    expect(a.visitsWeek).toBeGreaterThan(0);
    expect(a.openProposals.count).toBeGreaterThan(0);
    expect(a.acceptedProposals.count).toBeGreaterThan(0);
    expect(a.nextVisits.length).toBeGreaterThan(0);
    const b = (await call('GET', '/commercial/summary', 'adminB')).json();
    expect(b).toMatchObject({ visitsToday: 0, visitsWeek: 0, openProposals: { count: 0, value: 0 }, nextVisits: [] });
    const own = (await call('GET', '/commercial/summary', 'broker2')).json();
    expect(own.openProposals.count).toBe(0);
  });
});
