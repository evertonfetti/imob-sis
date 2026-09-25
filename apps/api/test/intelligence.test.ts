import { createPrismaClient } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IntelligenceScheduler } from '../src/intelligence/intelligence.scheduler';
import { scoreMatch, type Candidate, type MatchCriteria } from '../src/intelligence/matching.service';
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

async function property(over: Record<string, unknown> = {}, publish = true) {
  const p = (await call('POST', '/properties', 'admin', { title: 'Imóvel inteligente', purpose: 'SALE', typeId, salePrice: 800000, city: 'Campinas', neighborhood: 'Cambuí', bedrooms: 3, ...over })).json();
  if (publish) { await uploadPhoto(app, tk.admin!, p.id); await call('POST', `/properties/${p.id}/publish`, 'admin'); }
  return p as { id: string; code: string };
}
async function lead(over: Record<string, unknown> = {}, who = 'admin') {
  const n = ++seq;
  const r = await call('POST', '/leads', who, { customer: { name: `Interessado ${n}`, phone: `1192000${String(n).padStart(4, '0')}` }, ...over });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string };
}
const score = async (id: string) => (await call('GET', `/leads/${id}/score`, 'admin')).json() as { score: number; temperature: string; factors: { key: string; earned: boolean }[] };
const tasks = (leadId: string) => prisma.task.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  ids.broker = (await call('GET', '/auth/me', 'broker')).json().id;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

// ---------- pontuação do matching (função pura) ----------
const cand = (o: Partial<Candidate> = {}): Candidate => ({ id: 'p', purpose: 'SALE', typeId: 't1', city: 'Campinas', neighborhood: 'Cambuí', bedrooms: 3, salePrice: 800000, rentPrice: null, minimumNegotiationPrice: null, featureIds: [], ...o });
const crit = (o: Partial<MatchCriteria> = {}): MatchCriteria => ({ purpose: 'SALE', budgetMin: null, budgetMax: null, city: null, neighborhood: null, bedrooms: null, typeId: null, featureIds: [], ...o });

describe('matching: pontuação', () => {
  it('nota 100 quando tudo bate; só conta o que o lead informou; ignora acento e caixa', () => {
    const full = scoreMatch(crit({ budgetMax: 900000, city: 'CAMPINAS', neighborhood: 'cambui', bedrooms: 3, typeId: 't1' }), cand())!;
    expect(full.score).toBe(100);
    expect(full.reasons).toEqual(expect.arrayContaining(['Mesma cidade (Campinas)', 'Mesmo bairro (Cambuí)']));
    // só cidade informada: bate = 100, não bate = 0 (não é penalizado pelo que faltou informar)
    expect(scoreMatch(crit({ city: 'Campinas' }), cand())!.score).toBe(100);
    expect(scoreMatch(crit({ city: 'Santos' }), cand())).toBeNull(); // outra cidade é descartada
  });

  it('descarta finalidade incompatível, outra cidade e imóvel muito acima do orçamento; aceita venda e locação no mesmo imóvel', () => {
    expect(scoreMatch(crit({ purpose: 'RENT', city: 'Campinas' }), cand({ purpose: 'SALE' }))).toBeNull();
    expect(scoreMatch(crit({ purpose: 'RENT', city: 'Campinas' }), cand({ purpose: 'SALE_AND_RENT', rentPrice: 3000 }))).not.toBeNull();
    expect(scoreMatch(crit({ budgetMax: 600000 }), cand({ salePrice: 800000 }))).toBeNull(); // +33%
    expect(scoreMatch(crit({ budgetMax: 700000 }), cand({ salePrice: 800000 }))!.score).toBeLessThan(50); // +14%: perde pontos mas não some
  });

  it('acima do orçamento: cabe com negociação > até 10% acima > acima; abaixo do piso perde metade', () => {
    const at = (price: number, min: number | null = null) => scoreMatch(crit({ budgetMax: 1000000 }), cand({ salePrice: price, minimumNegotiationPrice: min }))!.score;
    expect(at(950000)).toBe(100);
    expect(at(1080000, 950000)).toBe(73); // 22/30
    expect(at(1080000)).toBe(50); // 15/30
    expect(at(1200000)).toBe(20); // 6/30
    expect(scoreMatch(crit({ budgetMin: 900000, budgetMax: 1000000 }), cand({ salePrice: 500000 }))!.score).toBe(50);
  });

  it('dormitórios: igual > um a mais > mais > um a menos', () => {
    const b = (n: number) => scoreMatch(crit({ bedrooms: 3 }), cand({ bedrooms: n }))!.score;
    expect([b(3), b(4), b(6), b(2), b(1)]).toEqual([100, 80, 53, 40, 0]);
  });
});

describe('score do lead', () => {
  it('soma as regras conforme o lead avança e vira quente uma única vez (tarefa + timeline)', async () => {
    const p = await property();
    const l = await lead({ propertyId: p.id, brokerId: ids.broker });
    await new Promise((r) => setTimeout(r, 100));
    expect((await score(l.id)).score).toBe(0);
    expect((await score(l.id)).temperature).toBe('COLD');

    await call('PATCH', `/leads/${l.id}`, 'admin', { budgetMax: 900000 });
    expect((await score(l.id)).score).toBe(10);

    const v = (await call('POST', '/visits', 'admin', { leadId: l.id, brokerId: ids.broker, scheduledAt: inMin(20) })).json();
    let s = await score(l.id);
    expect(s.score).toBe(10 + 15 + 20);
    expect(s.temperature).toBe('WARM');

    await call('PATCH', `/visits/${v.id}`, 'admin', { status: 'COMPLETED', feedback: 'Gostou.' });
    s = await score(l.id);
    expect(s.score).toBe(70); // + realizou visita → quente
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).score).toBe(70); // gravado
    expect(s.temperature).toBe('HOT');
    const hot = (await tasks(l.id)).filter((t) => t.ref === `hot:${l.id}`);
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({ assignedUserId: ids.broker, priority: 'HIGH', status: 'OPEN' });
    expect((await call('GET', `/leads/${l.id}`, 'admin')).json().timeline.filter((t: { type: string }) => t.type === 'SCORE_HOT')).toHaveLength(1);

    await call('POST', '/proposals', 'admin', { leadId: l.id, proposedPrice: 780000 });
    expect((await score(l.id)).score).toBe(100); // 110 limitado a 100
    expect((await tasks(l.id)).filter((t) => t.ref === `hot:${l.id}`)).toHaveLength(1); // não repete
  });

  it('visita cancelada devolve pontos; lead de outra empresa/escopo não é acessível', async () => {
    const p = await property();
    const l = await lead({ propertyId: p.id, brokerId: ids.broker });
    const v = (await call('POST', '/visits', 'admin', { leadId: l.id, brokerId: ids.broker, scheduledAt: inMin(3000) })).json();
    expect((await score(l.id)).score).toBe(35);
    await call('PATCH', `/visits/${v.id}`, 'admin', { status: 'CANCELLED' });
    expect((await score(l.id)).score).toBe(15); // ainda "solicitou visita"
    expect((await call('GET', `/leads/${l.id}/score`, 'adminB')).statusCode).toBe(404);
    const other = await lead({}, 'admin'); // sem responsável → invisível ao corretor
    expect((await call('GET', `/leads/${other.id}/score`, 'broker')).statusCode).toBe(404);
  });

  it('a rotina preenche o score de leads antigos (sem cálculo)', async () => {
    const l = await lead({ budgetMin: 500000 });
    await prisma.lead.update({ where: { id: l.id }, data: { score: 0, scoreUpdatedAt: null } });
    const r = await app.get(IntelligenceScheduler).tick();
    expect(r.scored).toBeGreaterThanOrEqual(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).score).toBe(10);
  });
});

describe('matching pela API', () => {
  it('lista imóveis compatíveis em ordem, só disponíveis e publicados, com motivos; pede mais dados quando faltam', async () => {
    const best = await property({ title: 'Casa ideal', salePrice: 850000, city: 'Ribeirão Preto', neighborhood: 'Jardim Botânico', bedrooms: 4 });
    const ok = await property({ title: 'Casa parecida', salePrice: 950000, city: 'Ribeirão Preto', neighborhood: 'Centro', bedrooms: 3 });
    await property({ title: 'Outra cidade', salePrice: 850000, city: 'Manaus', neighborhood: 'Centro', bedrooms: 4 });
    await property({ title: 'Cara demais', salePrice: 2000000, city: 'Ribeirão Preto', neighborhood: 'Jardim Botânico', bedrooms: 4 });
    await property({ title: 'Aluguel', purpose: 'RENT', salePrice: undefined, rentPrice: 5000, city: 'Ribeirão Preto', neighborhood: 'Jardim Botânico', bedrooms: 4 });
    const draft = await property({ title: 'Rascunho', salePrice: 850000, city: 'Ribeirão Preto', neighborhood: 'Jardim Botânico', bedrooms: 4 }, false);
    const sold = await property({ title: 'Vendida', salePrice: 850000, city: 'Ribeirão Preto', neighborhood: 'Jardim Botânico', bedrooms: 4 });
    await call('PATCH', `/properties/${sold.id}`, 'admin', { status: 'SOLD' });

    const l = await lead({ purpose: 'SALE', budgetMax: 900000, city: 'Ribeirão Preto', neighborhood: 'Jardim Botânico', bedrooms: 4 });
    const r = (await call('GET', `/leads/${l.id}/matches`, 'admin')).json();
    const titles = r.items.map((m: { property: { title: string } }) => m.property.title);
    expect(titles[0]).toBe('Casa ideal');
    expect(r.items[0]).toMatchObject({ propertyId: best.id, score: 100 });
    expect(r.items[0].reasons).toEqual(expect.arrayContaining(['Mesmo bairro (Jardim Botânico)', 'Disponível para venda']));
    expect(titles).toContain('Casa parecida');
    expect(r.items.find((m: { propertyId: string }) => m.propertyId === ok.id).score).toBeLessThan(100);
    for (const bad of ['Outra cidade', 'Cara demais', 'Aluguel', 'Rascunho', 'Vendida']) expect(titles).not.toContain(bad);
    expect(r.items.map((m: { propertyId: string }) => m.propertyId)).not.toContain(draft.id);
    expect(r.insufficientData).toBe(false);

    const empty = await lead({});
    const e = (await call('GET', `/leads/${empty.id}/matches`, 'admin')).json();
    expect(e).toMatchObject({ items: [], insufficientData: true });
  });

  it('o imóvel de interesse traz tipo/finalidade; ele mesmo não é sugerido; escopo do corretor e multiempresa valem', async () => {
    const interest = await property({ title: 'Interesse original', salePrice: 400000, city: 'Londrina', neighborhood: 'Gleba', bedrooms: 2 });
    const twin = await property({ title: 'Gêmeo', salePrice: 420000, city: 'Londrina', neighborhood: 'Gleba', bedrooms: 2 });
    const l = await lead({ propertyId: interest.id, budgetMax: 450000, city: 'Londrina', brokerId: ids.broker });
    const r = (await call('GET', `/leads/${l.id}/matches`, 'admin')).json();
    const got = r.items.map((m: { propertyId: string }) => m.propertyId);
    expect(got).toContain(twin.id);
    expect(got).not.toContain(interest.id);
    expect((await call('GET', `/leads/${l.id}/matches`, 'broker')).statusCode).toBe(200);
    expect((await call('GET', `/leads/${l.id}/matches`, 'adminB')).statusCode).toBe(404);
    const foreign = await lead({ budgetMax: 450000, city: 'Londrina' }); // do admin, sem corretor
    expect((await call('GET', `/leads/${foreign.id}/matches`, 'broker')).statusCode).toBe(404);
  });

  it('no sentido inverso, lista os leads em aberto que combinam com o imóvel (fechados ficam de fora)', async () => {
    const p = await property({ title: 'Para leads', salePrice: 600000, city: 'Bauru', neighborhood: 'Vila Nova', bedrooms: 3 });
    const yes = await lead({ purpose: 'SALE', budgetMax: 650000, city: 'Bauru', bedrooms: 3 });
    const no = await lead({ purpose: 'SALE', budgetMax: 650000, city: 'Recife', bedrooms: 3 });
    const won = await lead({ purpose: 'SALE', budgetMax: 650000, city: 'Bauru', bedrooms: 3 });
    await prisma.lead.update({ where: { id: won.id }, data: { status: 'WON' } });
    const r = (await call('GET', `/properties/${p.id}/matches`, 'admin')).json();
    const got = r.items.map((m: { leadId: string }) => m.leadId);
    expect(got).toContain(yes.id);
    expect(got).not.toContain(no.id);
    expect(got).not.toContain(won.id);
    expect((await call('GET', `/properties/${p.id}/matches`, 'adminB')).statusCode).toBe(404);
  });
});

describe('automações', () => {
  it('imóvel novo publicado gera tarefa (uma vez) para leads muito compatíveis que têm responsável', async () => {
    const withBroker = await lead({ purpose: 'SALE', budgetMax: 1300000, city: 'Piracicaba', neighborhood: 'Nova Suíça', bedrooms: 3, brokerId: ids.broker });
    const noBroker = await lead({ purpose: 'SALE', budgetMax: 1300000, city: 'Piracicaba', neighborhood: 'Nova Suíça', bedrooms: 3 });
    await call('POST', `/leads/${noBroker.id}/assign`, 'admin', { brokerId: null });
    const weak = await lead({ purpose: 'SALE', budgetMax: 1300000, city: 'Outra', bedrooms: 3, brokerId: ids.broker });

    const p = await property({ title: 'Recém-chegado', salePrice: 1200000, city: 'Piracicaba', neighborhood: 'Nova Suíça', bedrooms: 3 });
    const t = (await tasks(withBroker.id)).filter((x) => x.ref === `match:${withBroker.id}:${p.id}`);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ assignedUserId: ids.broker, status: 'OPEN' });
    expect(t[0]!.title).toContain(p.code);
    expect((await call('GET', `/leads/${withBroker.id}`, 'admin')).json().timeline.some((x: { type: string }) => x.type === 'PROPERTY_MATCH')).toBe(true);
    expect((await tasks(weak.id)).some((x) => x.ref?.startsWith('match:'))).toBe(false);
    expect((await tasks(noBroker.id)).some((x) => x.ref?.startsWith('match:'))).toBe(false);

    // despublicar e publicar de novo não duplica
    await call('POST', `/properties/${p.id}/unpublish`, 'admin');
    await call('POST', `/properties/${p.id}/publish`, 'admin');
    expect((await tasks(withBroker.id)).filter((x) => x.ref === `match:${withBroker.id}:${p.id}`)).toHaveLength(1);
  });

  it('lead parado há mais de 7 dias ganha UMA tarefa de retomada por período parado; fechar o lead cancela follow-ups automáticos e preserva os manuais', async () => {
    const stages = (await call('GET', '/pipeline', 'admin')).json().stages as { id: string; name: string }[];
    const l = await lead({ brokerId: ids.broker });
    await call('POST', `/leads/${l.id}/change-stage`, 'admin', { stageId: stages.find((s) => s.name === 'Contato realizado')!.id });
    await prisma.lead.update({ where: { id: l.id }, data: { stageEnteredAt: new Date(Date.now() - 9 * 86_400_000) } });
    const sched = app.get(IntelligenceScheduler);
    await sched.tick();
    await sched.tick();
    const stale = (await tasks(l.id)).filter((t) => t.ref?.startsWith('stale:'));
    expect(stale).toHaveLength(1);
    expect(stale[0]!.title).toContain('parado há 9 dias');

    await call('POST', '/tasks', 'admin', { title: 'Tarefa manual do corretor', type: 'CALL', priority: 'LOW', leadId: l.id });
    await call('POST', `/leads/${l.id}/change-stage`, 'admin', { stageId: stages.find((s) => s.name === 'Fechado')!.id });
    const after = await tasks(l.id);
    expect(after.filter((t) => t.createdById === null && t.status === 'OPEN')).toHaveLength(0);
    expect(after.find((t) => t.title === 'Tarefa manual do corretor')!.status).toBe('OPEN');
  });
});

describe('alertas', () => {
  it('aponta o que exige ação, respeitando o escopo de cada usuário', async () => {
    const p = await property({ title: 'Alertas' });
    // lead sem atendimento há 30 h (com corretor) e outro do admin (sem corretor)
    const mine = await lead({ propertyId: p.id, brokerId: ids.broker });
    const others = await lead({});
    await call('POST', `/leads/${others.id}/assign`, 'admin', { brokerId: null });
    await prisma.lead.updateMany({ where: { id: { in: [mine.id, others.id] } }, data: { stageEnteredAt: new Date(Date.now() - 30 * 3_600_000) } });
    // tarefa atrasada do corretor
    await prisma.task.create({ data: { companyId: (await prisma.lead.findUniqueOrThrow({ where: { id: mine.id } })).companyId, leadId: mine.id, assignedUserId: ids.broker, title: 'Atrasada', type: 'CALL', priority: 'LOW', dueAt: new Date(Date.now() - 3_600_000), createdById: ids.broker } });
    // proposta vencendo em 10 h
    const withProposal = await lead({ propertyId: p.id, brokerId: ids.broker });
    await call('POST', '/proposals', 'admin', { leadId: withProposal.id, proposedPrice: 700000, validUntil: inMin(600) });
    // WhatsApp sem resposta há 5 h
    await prisma.conversation.create({ data: { companyId: (await prisma.lead.findUniqueOrThrow({ where: { id: mine.id } })).companyId, leadId: mine.id, externalId: `5511${Date.now()}`, unreadCount: 2, lastInboundAt: new Date(Date.now() - 5 * 3_600_000), lastMessageAt: new Date(Date.now() - 5 * 3_600_000) } });

    const a = (await call('GET', '/alerts', 'admin')).json();
    const types = a.items.map((x: { type: string }) => x.type);
    expect(types).toEqual(expect.arrayContaining(['LEAD_UNATTENDED', 'TASKS_OVERDUE', 'PROPOSAL_EXPIRING', 'WHATSAPP_WAITING']));
    const un = a.items.find((x: { id: string }) => x.id === `unattended:${mine.id}`);
    expect(un).toMatchObject({ severity: 'high', href: `/leads/${mine.id}` }); // > 24 h
    expect(a.items.some((x: { id: string }) => x.id === `unattended:${others.id}`)).toBe(true);
    expect(a.high).toBeGreaterThanOrEqual(3);
    // ordenado por gravidade
    const sev = a.items.map((x: { severity: string }) => ({ high: 0, medium: 1, low: 2 })[x.severity as 'high']);
    expect([...sev].sort()).toEqual(sev);

    // o corretor só vê o que é dele
    const b = (await call('GET', '/alerts', 'broker')).json();
    expect(b.items.some((x: { id: string }) => x.id === `unattended:${mine.id}`)).toBe(true);
    expect(b.items.some((x: { id: string }) => x.id === `unattended:${others.id}`)).toBe(false);
    // outra empresa não vê nada disso
    expect((await call('GET', '/alerts', 'adminB')).json().items.some((x: { id: string }) => x.id.includes(mine.id))).toBe(false);
  });
});

describe('relatórios', () => {
  it('resume o período: origem, dia a dia (sem buracos), funil da coorte, imóveis mais procurados, motivos de perda, corretores', async () => {
    const stages = (await call('GET', '/pipeline', 'admin')).json().stages as { id: string; name: string }[];
    const st = (n: string) => stages.find((s) => s.name === n)!.id;
    const from = new Date(Date.now() - 6 * 86_400_000).toISOString();
    const r0 = (await call('GET', `/reports/overview?from=${encodeURIComponent(from)}`, 'admin')).json();
    const src0 = r0.bySource.find((s: { source: string }) => s.source === 'SITE')?.leads ?? 0;
    const brk0 = r0.brokers.find((x: { brokerId: string }) => x.brokerId === ids.broker) ?? { won: 0, visitsDone: 0 };
    const hot = await property({ title: 'Mais procurado' });
    const a = await lead({ propertyId: hot.id, brokerId: ids.broker, source: 'SITE' });
    const b = await lead({ propertyId: hot.id, brokerId: ids.broker, source: 'SITE' });
    const c = await lead({ propertyId: hot.id, brokerId: ids.broker });
    await call('POST', `/leads/${a.id}/change-stage`, 'admin', { stageId: st('Qualificado') });
    await call('POST', `/leads/${a.id}/change-stage`, 'admin', { stageId: st('Fechado') });
    await call('POST', `/leads/${b.id}/change-stage`, 'admin', { stageId: st('Perdido'), lostReason: 'Fora do orçamento' });
    await call('POST', `/leads/${c.id}/change-stage`, 'admin', { stageId: st('Qualificado') });
    await call('POST', '/visits', 'admin', { leadId: c.id, brokerId: ids.broker, scheduledAt: inMin(15) }).then((r) => call('PATCH', `/visits/${r.json().id}`, 'admin', { status: 'COMPLETED' }));

    const r = (await call('GET', `/reports/overview?from=${encodeURIComponent(from)}`, 'admin')).json();
    expect(r.kpis.newLeads - r0.kpis.newLeads).toBe(3);
    expect(r.kpis.wonLeads - r0.kpis.wonLeads).toBe(1);
    expect(r.kpis.lostLeads - r0.kpis.lostLeads).toBe(1);
    expect(r.kpis.visitsDone - r0.kpis.visitsDone).toBe(1);
    expect(r.kpis.conversionRate).toBeGreaterThan(0);
    expect(r.byDay).toHaveLength(7); // um item por dia, mesmo sem leads
    expect(r.byDay.reduce((n: number, d: { leads: number }) => n + d.leads, 0)).toBe(r.kpis.newLeads);
    expect(r.bySource.find((s: { source: string }) => s.source === 'SITE').leads - src0).toBe(2);
    const funnel = Object.fromEntries(r.funnel.map((f: { name: string; reached: number }) => [f.name, f.reached]));
    expect(funnel['Qualificado']).toBeGreaterThanOrEqual(2);
    const steps = r.funnel.map((f: { reached: number }) => f.reached);
    expect([...steps].sort((a: number, b: number) => b - a)).toEqual(steps); // nunca cresce ao descer o funil
    expect(funnel['Fechado']).toBeGreaterThanOrEqual(1);
    expect(r.funnel.some((f: { name: string }) => f.name === 'Perdido')).toBe(false); // perda é mostrada à parte
    expect(r.topProperties[0]).toMatchObject({ propertyId: hot.id, leads: 3, visits: 1 });
    expect(r.lostReasons).toEqual(expect.arrayContaining([{ reason: 'Fora do orçamento', count: 1 }]));
    const brk = r.brokers.find((x: { brokerId: string }) => x.brokerId === ids.broker);
    expect(brk.won - brk0.won).toBe(1);
    expect(brk.visitsDone - brk0.visitsDone).toBe(1);

    // corretor: só os próprios números e sem ranking da equipe
    const mine = (await call('GET', `/reports/overview?from=${encodeURIComponent(from)}`, 'broker')).json();
    expect(mine.brokers).toBeNull();
    expect(mine.kpis.newLeads).toBeLessThanOrEqual(r.kpis.newLeads);
    expect(mine.kpis.newLeads).toBeGreaterThanOrEqual(3);
    // outra empresa: zero
    expect((await call('GET', '/reports/overview', 'adminB')).json().kpis).toMatchObject({ newLeads: 0, wonLeads: 0, dealValue: 0 });
  });
});

describe('configurações de alertas e automações', () => {
  const put = (payload: unknown, who = 'admin') => app.inject({ method: 'PUT', url: '/api/v1/intelligence/settings', headers: auth(tk[who]!), payload: payload as never });
  const reset = () => app.inject({ method: 'POST', url: '/api/v1/intelligence/settings/reset', headers: auth(tk.admin!) });

  it('começa nos padrões; só quem administra a empresa lê/altera; valida faixas e regras entre campos; edição parcial não mexe no resto; cada empresa tem a sua', async () => {
    const d = (await call('GET', '/intelligence/settings', 'admin')).json();
    expect(d.settings).toEqual(d.defaults);
    expect(d.settings).toMatchObject({ staleDays: 7, unattendedHours: 2, matchMinScore: 50, matchAutoTaskScore: 75, autoStaleTasks: true });
    expect((await call('GET', '/intelligence/settings', 'broker')).statusCode).toBe(403);
    expect((await put({ staleDays: 3 }, 'broker'))!.statusCode).toBe(403);

    expect((await put({ staleDays: 0 }))!.statusCode).toBe(400);
    expect((await put({ staleDays: 500 }))!.statusCode).toBe(400);
    expect((await put({ matchMinScore: 10 }))!.statusCode).toBe(400);
    expect((await put({ unattendedHours: 30 }))!.json().message).toContain('urgente'); // 30 h >= urgente (24 h)
    expect((await put({ matchMinScore: 90 }))!.json().message).toContain('compatibilidade'); // > automática (75)
    expect((await call('GET', '/intelligence/settings', 'admin')).json().settings.unattendedHours).toBe(2); // recusado não grava

    const ok = (await put({ staleDays: 3, autoMatchTasks: false }))!.json();
    expect(ok.settings).toMatchObject({ staleDays: 3, autoMatchTasks: false, unattendedHours: 2, proposalIdleDays: 5, autoStaleTasks: true }); // o resto ficou como estava
    expect((await call('GET', '/intelligence/settings', 'adminB')).json().settings.staleDays).toBe(7);
    expect((await prisma.auditLog.findMany({ where: { entity: 'COMPANY', action: 'UPDATE' } })).some((a) => JSON.stringify(a.after).includes('"staleDays":3'))).toBe(true);

    expect((await reset()).json().settings).toEqual(d.defaults);
  });

  it('os limites mudam o comportamento: dias parado, lead sem atendimento, tarefas automáticas e nota mínima do matching', async () => {
    const stages = (await call('GET', '/pipeline', 'admin')).json().stages as { id: string; name: string }[];
    const stale = await lead({ brokerId: ids.broker });
    await call('POST', `/leads/${stale.id}/change-stage`, 'admin', { stageId: stages.find((s) => s.name === 'Contato realizado')!.id });
    await prisma.lead.update({ where: { id: stale.id }, data: { stageEnteredAt: new Date(Date.now() - 4 * 86_400_000) } });
    const sched = app.get(IntelligenceScheduler);
    await sched.staleLeads();
    expect((await tasks(stale.id)).some((t) => t.ref?.startsWith('stale:'))).toBe(false); // 4 dias < 7 (padrão)
    await put({ staleDays: 3 });
    await sched.staleLeads();
    expect((await tasks(stale.id)).filter((t) => t.ref?.startsWith('stale:'))).toHaveLength(1);
    // desligar a automação: novo lead parado não gera tarefa
    const stale2 = await lead({ brokerId: ids.broker });
    await call('POST', `/leads/${stale2.id}/change-stage`, 'admin', { stageId: stages.find((s) => s.name === 'Contato realizado')!.id });
    await prisma.lead.update({ where: { id: stale2.id }, data: { stageEnteredAt: new Date(Date.now() - 10 * 86_400_000) } });
    await put({ autoStaleTasks: false });
    await sched.staleLeads();
    expect((await tasks(stale2.id)).some((t) => t.ref?.startsWith('stale:'))).toBe(false);
    await reset();

    // alerta de lead sem atendimento respeita o prazo da empresa (30 h ≥ 24 h padrão urgente)
    const waiting = await lead({ brokerId: ids.broker });
    await prisma.lead.update({ where: { id: waiting.id }, data: { stageEnteredAt: new Date(Date.now() - 30 * 3_600_000) } });
    const ids1 = ((await call('GET', '/alerts', 'admin')).json().items as { id: string }[]).map((a) => a.id);
    expect(ids1).toContain(`unattended:${waiting.id}`);
    await put({ unattendedHours: 48, unattendedHighHours: 96 });
    expect(((await call('GET', '/alerts', 'admin')).json().items as { id: string }[]).map((a) => a.id)).not.toContain(`unattended:${waiting.id}`);
    await reset();

    // tarefa automática de imóvel novo: desligada não cria; nota mínima da lista muda o resultado
    const cityLead = await lead({ purpose: 'SALE', budgetMax: 500000, city: 'Marília', bedrooms: 3, brokerId: ids.broker });
    await put({ autoMatchTasks: false });
    const p1 = await property({ title: 'Sem tarefa', salePrice: 480000, city: 'Marília', bedrooms: 3 });
    expect((await tasks(cityLead.id)).some((t) => t.ref === `match:${cityLead.id}:${p1.id}`)).toBe(false);
    await reset();
    const near = await property({ title: 'Quase', salePrice: 540000, city: 'Marília', bedrooms: 3 }); // 8% acima: nota < 100 mas ≥ 50
    const before = ((await call('GET', `/leads/${cityLead.id}/matches`, 'admin')).json().items as { propertyId: string }[]).map((m) => m.propertyId);
    expect(before).toContain(near.id);
    await put({ matchMinScore: 95, matchAutoTaskScore: 95 });
    const strict = ((await call('GET', `/leads/${cityLead.id}/matches`, 'admin')).json().items as { propertyId: string }[]).map((m) => m.propertyId);
    expect(strict).not.toContain(near.id);
    expect(strict).toContain(p1.id);
    await reset();
  });

  it('mede a operação: mediana e 80% do tempo que os leads ficam nas etapas (só com amostra suficiente)', async () => {
    const stages = (await prisma.pipelineStage.findMany({ where: { pipeline: { company: { users: { some: { id: ids.broker } } } } }, orderBy: { position: 'asc' } }));
    const [first, second] = stages;
    const company = (await prisma.user.findUniqueOrThrow({ where: { id: ids.broker } })).companyId;
    const empty = (await call('GET', '/intelligence/settings', 'adminB')).json().insights; // outra empresa: sem histórico
    expect(empty).toEqual({ firstStageHours: null, otherStagesDays: null });
    const base = Date.now() - 20 * 86_400_000;
    for (let i = 0; i < 6; i++) {
      const l = await lead({});
      await prisma.leadStageHistory.deleteMany({ where: { leadId: l.id } });
      // permanência de (i+1)*2 h na 1ª etapa e de 2 dias na 2ª
      const t0 = base + i * 3_600_000;
      const t1 = t0 + (i + 1) * 2 * 3_600_000;
      const t2 = t1 + 2 * 86_400_000;
      await prisma.leadStageHistory.createMany({ data: [
        { companyId: company, leadId: l.id, toStageId: first!.id, createdAt: new Date(t0) },
        { companyId: company, leadId: l.id, toStageId: second!.id, createdAt: new Date(t1) },
        { companyId: company, leadId: l.id, toStageId: stages[2]!.id, createdAt: new Date(t2) },
      ] });
    }
    const ins = (await call('GET', '/intelligence/settings', 'admin')).json().insights;
    expect(ins.firstStageHours.samples).toBeGreaterThanOrEqual(6);
    expect(ins.firstStageHours.p80).toBeGreaterThanOrEqual(ins.firstStageHours.median);
    expect(ins.otherStagesDays.median).toBeCloseTo(2, 0);
  });
});
