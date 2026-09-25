import { createPrismaClient } from '@imob/database';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, login, resetAndSeed, uploadPhoto } from './helpers';

let app: NestFastifyApplication;
const tk: Record<string, string> = {};
const ids: Record<string, string> = {};
let typeId: string;
let stages: { id: string; name: string; type: string; qualifies: boolean }[];
const prisma = createPrismaClient(process.env.TEST_DATABASE_URL ?? '');

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(tk[who]!), payload: payload as never });
const stage = (name: string) => stages.find((s) => s.name === name)!;
let phoneSeq = 0;
const newLead = (who: string, over: Record<string, unknown> = {}) =>
  call('POST', '/leads', who, { customer: { name: `Cliente ${++phoneSeq}`, phone: `1190000${String(phoneSeq).padStart(4, '0')}` }, ...over });

async function createUser(name: string, role: string) {
  const email = `${name.toLowerCase().replace(/\s/g, '.')}@teste.com`;
  const r = await call('POST', '/users', 'admin', { name, email, roleKey: role, password: 'Senha@12345' });
  expect(r.statusCode).toBe(201);
  tk[name] = (await login(app, email)).body.accessToken;
  ids[name] = r.json().id;
}

async function publishedProperty(brokerId?: string) {
  const p = (await call('POST', '/properties', 'admin', {
    title: 'Casa para o CRM', purpose: 'SALE', typeId, salePrice: 700000, city: 'Campinas', neighborhood: 'Taquaral', bedrooms: 3, ...(brokerId && { brokerId }),
  })).json();
  await uploadPhoto(app, tk.admin!, p.id);
  await call('POST', `/properties/${p.id}/publish`, 'admin');
  return p;
}

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  tk.admin = (await login(app, 'admin.a@teste.com')).body.accessToken;
  tk.broker = (await login(app, 'broker.a@teste.com')).body.accessToken;
  tk.adminB = (await login(app, 'admin.b@teste.com')).body.accessToken;
  ids.broker = (await call('GET', '/auth/me', 'broker')).json().id;
  ids.admin = (await call('GET', '/auth/me', 'admin')).json().id;
  typeId = (await call('GET', '/property-types', 'admin')).json()[0].id;
  stages = (await call('GET', '/pipeline', 'admin')).json().stages;
  await createUser('Corretor Dois', 'BROKER');
  await createUser('Corretor Tres', 'BROKER');
  await createUser('Atendente Um', 'ATTENDANT');
  await createUser('Marketing Um', 'MARKETING');
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('funil e leads do site', () => {
  it('cria o funil padrão e coloca o lead do site em "Novo", com timeline e tarefa de primeiro contato', async () => {
    expect(stages.map((s) => s.name)).toEqual(['Novo', 'Contato iniciado', 'Contato realizado', 'Qualificado', 'Imóveis apresentados', 'Visita agendada', 'Visita realizada', 'Proposta', 'Negociação', 'Fechado', 'Perdido']);
    expect(stages.filter((s) => s.qualifies).map((s) => s.name)).toEqual(['Qualificado']);

    const p = await publishedProperty(ids.broker);
    const res = await app.inject({ method: 'POST', url: '/api/v1/public/leads', payload: { name: 'Ana do Site', phone: '11988880000', consent: true, propertyId: p.id, message: 'Quero visitar' } });
    expect(res.statusCode).toBe(201);

    const list = (await call('GET', '/leads', 'admin')).json();
    const lead = list.items.find((l: { customer: { name: string } }) => l.customer.name === 'Ana do Site');
    expect(lead.stage.name).toBe('Novo');
    expect(lead.status).toBe('NEW');
    expect(lead.broker.id).toBe(ids.broker); // corretor do imóvel

    const detail = (await call('GET', `/leads/${lead.id}`, 'admin')).json();
    expect(detail.timeline.map((t: { type: string }) => t.type)).toEqual(expect.arrayContaining(['LEAD_CREATED', 'TASK_CREATED']));
    expect(detail.tasks).toHaveLength(1);
    expect(detail.tasks[0]).toMatchObject({ title: 'Fazer o primeiro contato', type: 'CALL', priority: 'HIGH', assignedUserId: ids.broker });
    const due = new Date(detail.tasks[0].dueAt).getTime() - Date.now();
    expect(due).toBeGreaterThan(20 * 60_000);
    expect(due).toBeLessThan(31 * 60_000);
  });
});

describe('estágios', () => {
  it('registra histórico e timeline, deriva o status, dispara lead.qualified uma única vez e exige motivo na perda', async () => {
    const qualified: unknown[] = [];
    const bus = app.get(EventEmitter2);
    bus.on('lead.qualified', (e) => qualified.push(e));

    const lead = (await newLead('admin')).json();
    const move = (name: string, extra: object = {}) => call('POST', `/leads/${lead.id}/change-stage`, 'admin', { stageId: stage(name).id, ...extra });

    expect((await move('Contato realizado')).json()).toMatchObject({ status: 'CONTACTED', stage: { name: 'Contato realizado' } });
    expect((await move('Qualificado')).json().status).toBe('QUALIFIED');
    expect(qualified).toHaveLength(1);
    await move('Visita agendada');
    await move('Qualificado'); // volta para o mesmo estágio
    expect(qualified).toHaveLength(1); // só na primeira vez

    const noReason = await move('Perdido');
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().code).toBe('LEAD_LOST_REASON_REQUIRED');
    const lost = (await move('Perdido', { lostReason: 'Comprou com outra imobiliária' })).json();
    expect(lost).toMatchObject({ status: 'LOST', lostReason: 'Comprou com outra imobiliária' });
    expect(lost.closedAt).toBeTruthy();
    const reopened = (await move('Negociação')).json();
    expect(reopened.closedAt).toBeNull();
    expect(reopened.lostReason).toBeNull();

    const history = await prisma.leadStageHistory.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: 'asc' } });
    expect(history.length).toBe(7); // criação + 6 movimentos
    expect(history[0]).toMatchObject({ fromStageId: null, toStageId: stage('Novo').id });
    expect(history.at(-1)).toMatchObject({ fromStageId: stage('Perdido').id, toStageId: stage('Negociação').id, userId: ids.admin });

    const timeline = (await call('GET', `/leads/${lead.id}`, 'admin')).json().timeline;
    expect(timeline.filter((t: { type: string }) => t.type === 'STAGE_CHANGED')).toHaveLength(6);
    const audit = (await call('GET', '/audit-logs?entity=LEAD&action=STAGE_CHANGE', 'admin')).json();
    expect(audit.items.length).toBeGreaterThanOrEqual(6);
    bus.removeAllListeners('lead.qualified');
  });

  it('o quadro agrupa por estágio com totais e respeita filtros', async () => {
    const board = (await call('GET', '/pipeline/board', 'admin')).json();
    expect(board.columns).toHaveLength(11);
    const total = board.columns.reduce((n: number, c: { total: number }) => n + c.total, 0);
    const all = (await call('GET', '/leads?pageSize=100', 'admin')).json().total;
    expect(total).toBe(all);
    const first = board.columns[0].leads[0];
    expect(first).toMatchObject({ customer: { name: expect.any(String) }, overdueTasks: expect.any(Number) });
    const none = (await call('GET', '/pipeline/board?brokerId=none', 'admin')).json();
    expect(none.columns.flatMap((c: { leads: { broker: unknown }[] }) => c.leads).every((l: { broker: unknown }) => l.broker === null)).toBe(true);
  });
});

describe('distribuição', () => {
  it('manual por padrão; rodízio alterna entre corretores; corretor do imóvel tem prioridade', async () => {
    expect((await newLead('admin')).json().broker).toBeNull(); // MANUAL

    const bad = await call('PATCH', '/company', 'admin', { leadDistribution: 'ALEATORIO' });
    expect(bad.statusCode).toBe(400);
    expect((await call('PATCH', '/company', 'admin', { leadDistribution: 'ROUND_ROBIN' })).json().leadDistribution).toBe('ROUND_ROBIN');

    const got: string[] = [];
    for (let i = 0; i < 4; i++) got.push((await newLead('admin')).json().broker.id);
    const brokers = [ids.broker, ids['Corretor Dois'], ids['Corretor Tres']];
    expect(new Set(got.slice(0, 3)).size).toBe(3); // os três recebem antes de repetir
    expect(brokers).toEqual(expect.arrayContaining(got.slice(0, 3)));
    expect(got[3]).toBe(got[0]); // volta para quem esperou mais

    const p = await publishedProperty(ids['Corretor Dois']);
    const withProp = (await newLead('admin', { propertyId: p.id })).json();
    expect(withProp.broker.id).toBe(ids['Corretor Dois']); // imóvel > rodízio

    // imóvel cujo responsável é o administrador (padrão de quem cadastra): não captura o lead, vale o rodízio
    const byAdmin = await publishedProperty(); // sem brokerId → responsável = quem criou (admin)
    const rr = (await newLead('admin', { propertyId: byAdmin.id })).json();
    expect(byAdmin.brokerId ?? ids.admin).toBe(ids.admin);
    expect(rr.broker.id).not.toBe(ids.admin);
    expect(brokers).toContain(rr.broker.id);

    const manual = (await newLead('admin', { brokerId: ids.broker })).json();
    expect(manual.broker.id).toBe(ids.broker); // escolha explícita > rodízio
    await call('PATCH', '/company', 'admin', { leadDistribution: 'MANUAL' });
  });

  it('atribuição manual, automática e remoção; tarefas em aberto acompanham o novo responsável', async () => {
    const lead = (await newLead('admin', { brokerId: ids.broker })).json();
    const tasksOf = async () => (await call('GET', `/leads/${lead.id}`, 'admin')).json().tasks;
    const t = (await call('POST', '/tasks', 'admin', { leadId: lead.id, title: 'Enviar opções', dueAt: new Date(Date.now() + 3_600_000).toISOString() })).json();
    expect(t.assignedUserId).toBe(ids.broker); // padrão: responsável do lead

    const moved = (await call('POST', `/leads/${lead.id}/assign`, 'admin', { brokerId: ids['Corretor Dois'] })).json();
    expect(moved.broker.id).toBe(ids['Corretor Dois']);
    expect((await tasksOf()).every((x: { assignedUserId: string }) => x.assignedUserId === ids['Corretor Dois'])).toBe(true);

    const auto = (await call('POST', `/leads/${lead.id}/assign`, 'admin', { auto: true })).json();
    expect(auto.broker.id).toBeTruthy();
    expect((await call('POST', `/leads/${lead.id}/assign`, 'admin', { brokerId: null })).json().broker).toBeNull();
    expect((await call('POST', `/leads/${lead.id}/assign`, 'admin', { brokerId: '00000000-0000-7000-8000-000000000000' })).json().code).toBe('LEAD_BROKER_INVALID');
    const tl = (await call('GET', `/leads/${lead.id}`, 'admin')).json().timeline;
    expect(tl.filter((x: { type: string }) => x.type === 'LEAD_ASSIGNED').length).toBeGreaterThanOrEqual(2); // o automático pode cair no mesmo corretor (sem mudança)
  });
});

describe('visibilidade e permissões', () => {
  it('corretor vê só os seus leads, clientes e tarefas; atendente e marketing veem todos', async () => {
    const mine = (await newLead('admin', { brokerId: ids.broker })).json();
    const other = (await newLead('admin', { brokerId: ids['Corretor Dois'] })).json();
    await call('POST', '/tasks', 'admin', { leadId: other.id, title: 'Tarefa alheia' });

    const list = (await call('GET', '/leads?pageSize=100', 'broker')).json();
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((l: { broker: { id: string } }) => l.broker?.id === ids.broker)).toBe(true);
    expect((await call('GET', `/leads/${mine.id}`, 'broker')).statusCode).toBe(200);
    expect((await call('GET', `/leads/${other.id}`, 'broker')).statusCode).toBe(404);
    expect((await call('POST', `/leads/${other.id}/change-stage`, 'broker', { stageId: stage('Qualificado').id })).statusCode).toBe(404);
    expect((await call('GET', `/customers/${other.customer.id}`, 'broker')).statusCode).toBe(404);
    expect((await call('GET', `/customers/${mine.customer.id}`, 'broker')).statusCode).toBe(200);

    const board = (await call('GET', '/pipeline/board', 'broker')).json();
    const onBoard = board.columns.flatMap((c: { leads: { id: string }[] }) => c.leads.map((l) => l.id));
    expect(onBoard).toContain(mine.id);
    expect(onBoard).not.toContain(other.id);
    const tasks = (await call('GET', '/tasks', 'broker')).json().items;
    expect(tasks.some((x: { title: string }) => x.title === 'Tarefa alheia')).toBe(false);

    for (const who of ['admin', 'Atendente Um', 'Marketing Um']) {
      expect((await call('GET', `/leads/${other.id}`, who)).statusCode).toBe(200);
    }
  });

  it('cada papel só faz o que pode: atribuir, mover, anotar, apagar e configurar o funil', async () => {
    const lead = (await newLead('admin', { brokerId: ids.broker })).json();
    expect((await call('POST', `/leads/${lead.id}/assign`, 'broker', { brokerId: ids.broker })).statusCode).toBe(403); // sem lead.assign
    expect((await call('POST', `/leads/${lead.id}/assign`, 'Atendente Um', { brokerId: ids['Corretor Dois'] })).statusCode).toBe(200);

    const mk = 'Marketing Um';
    expect((await call('GET', '/leads', mk)).statusCode).toBe(200);
    expect((await call('POST', `/leads/${lead.id}/change-stage`, mk, { stageId: stage('Qualificado').id })).statusCode).toBe(403);
    expect((await call('POST', `/leads/${lead.id}/notes`, mk, { text: 'oi' })).statusCode).toBe(403);
    expect((await call('POST', '/leads', mk, { customer: { name: 'Xis' } })).statusCode).toBe(403);

    expect((await call('DELETE', `/leads/${lead.id}`, 'Atendente Um')).statusCode).toBe(403); // sem lead.delete
    expect((await call('PATCH', `/pipeline/stages/${stage('Novo').id}`, 'broker', { name: 'Hack' })).statusCode).toBe(403);
    const renamed = await call('PATCH', `/pipeline/stages/${stage('Novo').id}`, 'admin', { name: 'Entrada', color: '#123456' });
    expect(renamed.json()).toMatchObject({ name: 'Entrada', color: '#123456' });
    await call('PATCH', `/pipeline/stages/${stage('Novo').id}`, 'admin', { name: 'Novo', color: '#8a8578' });
    expect((await call('PATCH', `/pipeline/stages/${stage('Novo').id}`, 'admin', { color: 'vermelho' })).statusCode).toBe(400);

    expect((await call('DELETE', `/leads/${lead.id}`, 'admin')).statusCode).toBe(204);
    expect((await call('GET', `/leads/${lead.id}`, 'admin')).statusCode).toBe(404);
  });
});

describe('tarefas e anotações', () => {
  it('cria, filtra por visão, conclui uma única vez e registra na timeline', async () => {
    const lead = (await newLead('admin', { brokerId: ids.broker })).json();
    const now = Date.now();
    const overdue = (await call('POST', '/tasks', 'admin', { leadId: lead.id, title: 'Atrasada', dueAt: new Date(now - 3_600_000).toISOString(), assignedUserId: ids.broker })).json();
    const today = (await call('POST', '/tasks', 'admin', { leadId: lead.id, title: 'Hoje', dueAt: new Date(now + 3_600_000).toISOString(), assignedUserId: ids.broker })).json();
    const later = (await call('POST', '/tasks', 'admin', { leadId: lead.id, title: 'Semana que vem', type: 'VISIT', priority: 'HIGH', dueAt: new Date(now + 5 * 86_400_000).toISOString(), assignedUserId: ids.broker })).json();

    const titles = async (qs: string) => (await call('GET', `/tasks?leadId=${lead.id}&${qs}`, 'admin')).json().items.map((t: { title: string }) => t.title);
    expect(await titles('view=open')).toEqual(expect.arrayContaining(['Atrasada', 'Hoje', 'Semana que vem']));
    expect(await titles('view=overdue')).toEqual(['Atrasada']);
    const from = new Date(now + 50 * 60_000).toISOString(); // exclui a atrasada e a de primeiro contato (+30 min)
    const to = new Date(now + 70 * 60_000).toISOString();
    expect(await titles(`view=today&from=${from}&to=${to}`)).toEqual(['Hoje']);
    const board = (await call('GET', '/pipeline/board', 'admin')).json();
    expect(board.columns.flatMap((c: { leads: { id: string; overdueTasks: number }[] }) => c.leads).find((l: { id: string }) => l.id === lead.id).overdueTasks).toBe(1);

    const done = await call('POST', `/tasks/${overdue.id}/complete`, 'broker');
    expect(done.json()).toMatchObject({ status: 'DONE' });
    expect(done.json().completedAt).toBeTruthy();
    expect((await call('POST', `/tasks/${overdue.id}/complete`, 'broker')).json().code).toBe('TASK_INVALID');
    expect(await titles('view=done')).toEqual(['Atrasada']);
    expect(await titles('view=overdue')).toEqual([]);

    // editar só o título não pode resetar tipo nem prioridade (regressão: .partial() com defaults)
    expect((await call('PATCH', `/tasks/${later.id}`, 'admin', { title: 'Renomeada' })).json()).toMatchObject({ title: 'Renomeada', type: 'VISIT', priority: 'HIGH' });
    expect((await call('PATCH', `/tasks/${later.id}`, 'admin', { priority: 'LOW' })).json()).toMatchObject({ title: 'Renomeada', type: 'VISIT', priority: 'LOW' });
    expect((await call('DELETE', `/tasks/${today.id}`, 'admin')).statusCode).toBe(204);
    expect(await titles('view=open')).not.toContain('Hoje');

    await call('POST', `/leads/${lead.id}/notes`, 'broker', { text: 'Cliente prefere ligar à noite.' });
    const tl = (await call('GET', `/leads/${lead.id}`, 'admin')).json().timeline;
    expect(tl.find((t: { type: string }) => t.type === 'NOTE_ADDED')).toMatchObject({ description: 'Cliente prefere ligar à noite.', userName: 'BROKER A' });
    expect(tl.some((t: { type: string }) => t.type === 'TASK_COMPLETED')).toBe(true);
  });
});

describe('cadastro manual e clientes', () => {
  it('reaproveita o cliente pelo telefone, valida referências e edita dados do lead com auditoria', async () => {
    const a = (await call('POST', '/leads', 'admin', { customer: { name: 'Paulo Reis', phone: '(19) 97777-1111', email: 'paulo@mail.com' }, source: 'PHONE', notes: 'Ligou pedindo casa' })).json();
    expect(a).toMatchObject({ source: 'PHONE', notes: 'Ligou pedindo casa' });
    expect(a.customer.phone).toBe('19977771111');
    const b = (await call('POST', '/leads', 'admin', { customer: { name: 'Paulo R.', phone: '19977771111' }, source: 'REFERRAL' })).json();
    expect(b.customer.id).toBe(a.customer.id); // mesmo telefone = mesmo cliente
    const customer = (await call('GET', `/customers/${a.customer.id}`, 'admin')).json();
    expect(customer.leads).toHaveLength(2);

    expect((await call('POST', '/leads', 'admin', { customerId: '00000000-0000-7000-8000-000000000000' })).json().code).toBe('LEAD_CUSTOMER_INVALID');
    expect((await call('POST', '/leads', 'admin', { customer: { name: 'X Y' }, propertyId: '00000000-0000-7000-8000-000000000000' })).json().code).toBe('PROPERTY_INVALID');
    expect((await call('POST', '/leads', 'admin', {})).statusCode).toBe(400);

    const upd = (await call('PATCH', `/leads/${a.id}`, 'admin', { budgetMax: 650000, city: 'Campinas', purchaseTimeline: 'Até 3 meses' })).json();
    expect(upd).toMatchObject({ budgetMax: 650000, city: 'Campinas', purchaseTimeline: 'Até 3 meses' });
    const audit = (await call('GET', '/audit-logs?entity=LEAD&action=UPDATE', 'admin')).json().items[0];
    expect(audit.after).toMatchObject({ budgetMax: 650000, city: 'Campinas' });

    expect((await call('PATCH', `/customers/${a.customer.id}`, 'admin', { name: 'Paulo dos Reis', phone: '(19) 98888-0000' })).json()).toMatchObject({ name: 'Paulo dos Reis', phone: '19988880000' });
    const search = (await call('GET', '/customers?search=19988880000', 'admin')).json();
    expect(search.items.map((c: { id: string }) => c.id)).toEqual([a.customer.id]);
  });
});

describe('multiempresa no CRM', () => {
  it('empresa B não vê, move, atribui, anota nem conclui nada da empresa A', async () => {
    const lead = (await newLead('admin', { brokerId: ids.broker })).json();
    const task = (await call('POST', '/tasks', 'admin', { leadId: lead.id, title: 'Privada' })).json();

    for (const [m, u, body] of [
      ['GET', `/leads/${lead.id}`, undefined],
      ['PATCH', `/leads/${lead.id}`, { city: 'X' }],
      ['POST', `/leads/${lead.id}/assign`, { brokerId: null }],
      ['POST', `/leads/${lead.id}/change-stage`, { stageId: stage('Qualificado').id }],
      ['POST', `/leads/${lead.id}/notes`, { text: 'invasão' }],
      ['DELETE', `/leads/${lead.id}`, undefined],
      ['GET', `/customers/${lead.customer.id}`, undefined],
      ['POST', `/tasks/${task.id}/complete`, undefined],
      ['PATCH', `/tasks/${task.id}`, { title: 'Invasão' }],
    ] as const) {
      expect((await call(m, u, 'adminB', body)).statusCode, `${m} ${u}`).toBe(404);
    }
    expect((await call('POST', '/tasks', 'adminB', { leadId: lead.id, title: 'Invasão' })).statusCode).toBe(404);

    const boardB = (await call('GET', '/pipeline/board', 'adminB')).json();
    expect(boardB.columns.reduce((n: number, c: { total: number }) => n + c.total, 0)).toBe(0);
    const stagesB = (await call('GET', '/pipeline', 'adminB')).json().stages;
    expect(stagesB).toHaveLength(11);
    expect(stagesB[0].id).not.toBe(stages[0]!.id); // funil próprio por empresa
    // estágio da empresa A não serve para lead da empresa B
    const leadB = (await call('POST', '/leads', 'adminB', { customer: { name: 'Cliente B', phone: '2199990000' } })).json();
    expect((await call('POST', `/leads/${leadB.id}/change-stage`, 'adminB', { stageId: stage('Qualificado').id })).json().code).toBe('LEAD_STAGE_INVALID');
    expect((await call('PATCH', `/pipeline/stages/${stage('Novo').id}`, 'adminB', { name: 'Hack' })).statusCode).toBe(404);
    expect((await call('GET', '/customers', 'adminB')).json().items.every((c: { companyId: string }) => c.companyId !== (lead.companyId as string))).toBe(true);
  });
});
