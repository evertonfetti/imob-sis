import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@imob/database';
import type {
  AssignLeadInput, ChangeStageInput, CreateLeadInput, LeadStatus, ListLeadsQuery, UpdateLeadInput,
} from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser, ReqCtx } from '../common/request-context';
import { blankToNull } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CrmEvents, type LeadAssignedEvent, type LeadCreatedEvent, type LeadQualifiedEvent, type LeadStageChangedEvent, type LeadUpdatedEvent,
} from './crm.events';
import { PipelineService } from './pipeline.service';
import { leadScope } from './visibility';

type Tx = Prisma.TransactionClient;
const num = (v: unknown) => (v == null ? null : Number(v));

const detailInclude = {
  customer: true,
  property: { select: { id: true, code: true, slug: true, title: true, status: true, purpose: true, salePrice: true, rentPrice: true, city: true, neighborhood: true } },
  broker: { select: { id: true, name: true } },
  stage: true,
  attribution: true,
} as const;

/** Status resumido do lead, derivado do estágio em que ele está. */
export function statusFor(stage: { type: string; position: number }, qualifiedPos: number | null): LeadStatus {
  if (stage.type === 'WON') return 'WON';
  if (stage.type === 'LOST') return 'LOST';
  if (qualifiedPos != null && stage.position >= qualifiedPos) return 'QUALIFIED';
  return stage.position === 0 ? 'NEW' : 'CONTACTED';
}

export interface NewLeadCore {
  companyId: string;
  customerId: string;
  propertyId?: string | null;
  /** undefined = decidir (corretor do imóvel → rodízio); null = sem responsável; string = esse corretor. */
  brokerId?: string | null;
  stageId?: string;
  source: string;
  notes?: string | null;
  extra?: Partial<Pick<CreateLeadInput, 'budgetMin' | 'budgetMax' | 'purpose' | 'city' | 'neighborhood' | 'bedrooms' | 'purchaseTimeline'>>;
  consentAt?: Date;
  attribution?: Record<string, string | null>;
  propertyDefaults?: { purpose?: string | null; city?: string | null; neighborhood?: string | null; bedrooms?: number | null; brokerId?: string | null; code?: string | null };
}

@Injectable()
export class LeadsService {
  private readonly log = new Logger('Leads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /** Emite eventos sem deixar uma falha de quem escuta derrubar a operação principal. */
  async emit(name: string, payload: unknown) {
    try { await this.events.emitAsync(name, payload); } catch (e) { this.log.error(`Falha ao processar ${name}: ${(e as Error).message}`); }
  }

  // ---------- Distribuição ----------
  /** Próximo corretor do rodízio: quem recebeu lead há mais tempo (ou nunca). Bloqueia a linha para evitar duplicidade. */
  async nextBroker(tx: Tx, companyId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE u."companyId" = ${companyId} AND u.status = 'ACTIVE' AND r.key = 'BROKER'
      ORDER BY u."lastLeadAssignedAt" ASC NULLS FIRST, u.name ASC
      LIMIT 1 FOR UPDATE OF u SKIP LOCKED`;
    const id = rows[0]?.id ?? null;
    if (id) await tx.user.update({ where: { id }, data: { lastLeadAssignedAt: new Date() } });
    return id;
  }

  private async assertBroker(tx: Tx, companyId: string, id: string) {
    const u = await tx.user.findFirst({ where: { id, companyId, status: 'ACTIVE' }, select: { id: true } });
    if (!u) throw new AppException('LEAD_BROKER_INVALID', 400);
  }

  private async resolveBroker(tx: Tx, i: NewLeadCore): Promise<string | null> {
    if (i.brokerId !== undefined) {
      if (i.brokerId) await this.assertBroker(tx, i.companyId, i.brokerId);
      return i.brokerId;
    }
    // O corretor do imóvel recebe os leads dele, mas só se for de fato um corretor: o responsável padrão de um
    // imóvel é quem o cadastrou (muitas vezes o administrador), e isso não pode anular a distribuição.
    const fromProperty = i.propertyDefaults?.brokerId;
    if (fromProperty) {
      const ok = await tx.user.findFirst({ where: { id: fromProperty, companyId: i.companyId, status: 'ACTIVE', role: { key: 'BROKER' } }, select: { id: true } });
      if (ok) return fromProperty;
    }
    const company = await tx.company.findUniqueOrThrow({ where: { id: i.companyId }, select: { leadDistribution: true } });
    return company.leadDistribution === 'ROUND_ROBIN' ? this.nextBroker(tx, i.companyId) : null;
  }

  // ---------- Criação (usada pelo painel e pelo site) ----------
  /** Só grava. Quem chama emite `emitCreated` depois do commit. */
  async createLead(tx: Tx, i: NewLeadCore) {
    const pipeline = await this.pipeline.get(i.companyId);
    const stage = i.stageId ? pipeline.stages.find((s) => s.id === i.stageId) : pipeline.stages[0];
    if (!stage) throw new AppException('LEAD_STAGE_INVALID', 400);
    const qualifiedPos = pipeline.stages.find((s) => s.qualifies)?.position ?? null;
    const brokerId = await this.resolveBroker(tx, i);
    const pd = i.propertyDefaults ?? {};
    const e = i.extra ?? {};

    const lead = await tx.lead.create({
      data: {
        companyId: i.companyId, customerId: i.customerId, propertyId: i.propertyId ?? null, brokerId,
        source: i.source as never, status: statusFor(stage, qualifiedPos), stageId: stage.id,
        notes: i.notes ?? null, consentAt: i.consentAt ?? null,
        purpose: (e.purpose ?? pd.purpose ?? null) as never, city: e.city ?? pd.city ?? null,
        neighborhood: e.neighborhood ?? pd.neighborhood ?? null, bedrooms: e.bedrooms ?? pd.bedrooms ?? null,
        budgetMin: e.budgetMin ?? null, budgetMax: e.budgetMax ?? null, purchaseTimeline: e.purchaseTimeline ?? null,
        ...(i.attribution && { attribution: { create: i.attribution } }),
        stageHistory: { create: { companyId: i.companyId, toStageId: stage.id } },
      },
    });
    return { lead, stageName: stage.name, brokerId, propertyCode: pd.code ?? null };
  }

  async emitCreated(r: { lead: { id: string; companyId: string; source: string; propertyId: string | null }; stageName: string; brokerId: string | null; propertyCode: string | null }, ctx?: ReqCtx) {
    await this.audit.record({
      companyId: r.lead.companyId, entity: 'LEAD', entityId: r.lead.id, action: 'CREATE',
      after: { source: r.lead.source, propertyId: r.lead.propertyId, propertyCode: r.propertyCode, brokerId: r.brokerId }, ctx,
    });
    const ev: LeadCreatedEvent = {
      companyId: r.lead.companyId, leadId: r.lead.id, userId: ctx?.user?.id ?? null, source: r.lead.source,
      propertyId: r.lead.propertyId, propertyCode: r.propertyCode, brokerId: r.brokerId, stageName: r.stageName,
    };
    await this.emit(CrmEvents.LeadCreated, ev);
  }

  /** Cadastro manual pelo painel (cliente existente ou novo). */
  async create(ctx: AuthedCtx, input: CreateLeadInput) {
    const { companyId } = ctx.user;
    const result = await this.prisma.$transaction(async (tx) => {
      let customerId = input.customerId;
      if (customerId) {
        if (!(await tx.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true } }))) throw new AppException('LEAD_CUSTOMER_INVALID', 400);
      } else {
        const c = input.customer!;
        const phone = (c.phone ?? '').replace(/\D/g, '') || null;
        const email = c.email || null;
        const existing = phone || email ? await tx.customer.findFirst({ where: { companyId, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] } }) : null;
        customerId = existing?.id ?? (await tx.customer.create({ data: { companyId, name: c.name, phone, whatsapp: phone, email, document: c.document || null, notes: c.notes || null } })).id;
      }
      let property: { id: string; code: string; purpose: string; city: string | null; neighborhood: string | null; bedrooms: number | null; brokerId: string | null } | null = null;
      if (input.propertyId) {
        property = await tx.property.findFirst({ where: { id: input.propertyId, companyId }, select: { id: true, code: true, purpose: true, city: true, neighborhood: true, bedrooms: true, brokerId: true } });
        if (!property) throw new AppException('PROPERTY_INVALID', 400, 'O imóvel informado não existe.');
      }
      return this.createLead(tx, {
        companyId, customerId, propertyId: property?.id, brokerId: input.brokerId, stageId: input.stageId, source: input.source,
        notes: input.notes, extra: input, propertyDefaults: property ? { ...property } : undefined,
      });
    });
    await this.emitCreated(result, ctx);
    return this.get(ctx.user, result.lead.id);
  }

  // ---------- Consultas ----------
  private present(l: Record<string, any>) {
    return { ...l, budgetMin: num(l.budgetMin), budgetMax: num(l.budgetMax) };
  }

  async list(user: AuthedUser, q: ListLeadsQuery) {
    const where = {
      ...leadScope(user),
      ...(q.source && { source: q.source }),
      ...(q.stageId && { stageId: q.stageId }),
      ...(q.brokerId && (q.brokerId === 'none' ? { brokerId: null } : { brokerId: q.brokerId })),
      ...(q.propertyId && { propertyId: q.propertyId }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.search && {
        customer: { OR: [
          { name: { contains: q.search, mode: 'insensitive' as const } },
          { phone: { contains: q.search.replace(/\D/g, '') || q.search } },
          { email: { contains: q.search, mode: 'insensitive' as const } },
        ] },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true } },
          property: { select: { id: true, code: true, title: true } },
          broker: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true, color: true, type: true } },
          attribution: { select: { utmSource: true, utmMedium: true, utmCampaign: true, fbclid: true, gclid: true, landingPage: true } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items: rows.map((r) => this.present(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async summary(user: AuthedUser) {
    const scope = leadScope(user);
    const pipeline = await this.pipeline.get(user.companyId);
    const first = pipeline.stages[0];
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [last7, total, unattended, overdue] = await Promise.all([
      this.prisma.lead.count({ where: { ...scope, createdAt: { gte: since } } }),
      this.prisma.lead.count({ where: scope }),
      // "Sem atendimento": ainda parados no primeiro estágio do funil.
      first ? this.prisma.lead.count({ where: { ...scope, OR: [{ stageId: first.id }, { stageId: null }] } }) : 0,
      this.prisma.task.count({ where: { companyId: user.companyId, status: 'OPEN', dueAt: { lt: new Date() }, assignedUserId: user.id } }),
    ]);
    return { last7Days: last7, total, unattended, overdueTasks: overdue };
  }

  private async load(user: AuthedUser, id: string) {
    const l = await this.prisma.lead.findFirst({ where: { id, ...leadScope(user) }, include: detailInclude });
    if (!l) throw notFound('Lead não encontrado.');
    return l;
  }

  async get(user: AuthedUser, id: string) {
    const lead = await this.load(user, id);
    const [timeline, tasks, conversation] = await Promise.all([
      this.prisma.timelineEvent.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.task.findMany({
        where: { leadId: id, status: 'OPEN' }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        include: { assignedUser: { select: { id: true, name: true } } },
      }),
      this.prisma.conversation.findFirst({ where: { leadId: id, companyId: user.companyId }, select: { id: true, unreadCount: true, lastMessageAt: true, lastMessagePreview: true } }),
    ]);
    const userIds = [...new Set(timeline.map((t) => t.userId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds }, companyId: user.companyId }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      ...this.present(lead),
      property: lead.property ? { ...lead.property, salePrice: num(lead.property.salePrice), rentPrice: num(lead.property.rentPrice) } : null,
      timeline: timeline.map((t) => ({ ...t, userName: t.userId ? (names.get(t.userId) ?? null) : null })),
      tasks,
      conversation,
    };
  }

  // ---------- Alterações ----------
  async update(ctx: AuthedCtx, id: string, input: UpdateLeadInput) {
    const { companyId } = ctx.user;
    const current = await this.load(ctx.user, id);
    if (input.propertyId) {
      if (!(await this.prisma.property.findFirst({ where: { id: input.propertyId, companyId }, select: { id: true } }))) {
        throw new AppException('PROPERTY_INVALID', 400, 'O imóvel informado não existe.');
      }
    }
    const updated = await this.prisma.lead.update({ where: { id }, data: blankToNull(input) as never, include: detailInclude });
    const snap = (l: Record<string, any>) => sanitize({ ...l, budgetMin: num(l.budgetMin), budgetMax: num(l.budgetMax), customer: undefined, property: undefined, broker: undefined, stage: undefined, attribution: undefined });
    const d = diff(snap(current), snap(updated));
    if (d.changed) {
      await this.audit.record({ companyId, entity: 'LEAD', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
      const ev: LeadUpdatedEvent = { companyId, leadId: id, userId: ctx.user.id, fields: Object.keys(d.after) };
      await this.emit(CrmEvents.LeadUpdated, ev);
    }
    return this.get(ctx.user, id);
  }

  async assign(ctx: AuthedCtx, id: string, input: AssignLeadInput) {
    const { companyId } = ctx.user;
    const lead = await this.load(ctx.user, id);
    const target = await this.prisma.$transaction(async (tx) => {
      let brokerId: string | null;
      if (input.auto) {
        brokerId = await this.nextBroker(tx, companyId);
        if (!brokerId) throw new AppException('LEAD_NO_BROKER_AVAILABLE', 409);
      } else {
        brokerId = input.brokerId ?? null;
        if (brokerId) await this.assertBroker(tx, companyId, brokerId);
      }
      await tx.lead.update({ where: { id }, data: { brokerId } });
      return brokerId;
    });
    if (target === lead.brokerId) return this.get(ctx.user, id);

    const name = target ? (await this.prisma.user.findUnique({ where: { id: target }, select: { name: true } }))?.name ?? null : null;
    await this.audit.record({ companyId, entity: 'LEAD', entityId: id, action: 'ASSIGN', before: { brokerId: lead.brokerId }, after: { brokerId: target }, ctx });
    const ev: LeadAssignedEvent = { companyId, leadId: id, userId: ctx.user.id, fromBrokerId: lead.brokerId, toBrokerId: target, toBrokerName: name, auto: !!input.auto };
    await this.emit(CrmEvents.LeadAssigned, ev);
    return this.get(ctx.user, id);
  }

  async changeStage(ctx: AuthedCtx, id: string, input: ChangeStageInput) {
    const { companyId } = ctx.user;
    const lead = await this.load(ctx.user, id);
    const pipeline = await this.pipeline.get(companyId);
    const to = pipeline.stages.find((s) => s.id === input.stageId);
    if (!to) throw new AppException('LEAD_STAGE_INVALID', 400);
    const from = lead.stage ?? pipeline.stages[0] ?? null;
    if (lead.stageId === to.id) return this.get(ctx.user, id);

    const reason = input.lostReason?.trim() || null;
    if (to.type === 'LOST' && (!reason || reason.length < 3)) throw new AppException('LEAD_LOST_REASON_REQUIRED', 400);

    const qualifiedPos = pipeline.stages.find((s) => s.qualifies)?.position ?? null;
    const closed = to.type !== 'OPEN';
    const firstTimeQualified = to.qualifies && (await this.prisma.leadStageHistory.count({ where: { leadId: id, toStageId: to.id } })) === 0;

    await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id },
        data: {
          stageId: to.id, stageEnteredAt: new Date(), status: statusFor(to, qualifiedPos),
          closedAt: closed ? new Date() : null, lostReason: to.type === 'LOST' ? reason : null,
        },
      }),
      this.prisma.leadStageHistory.create({ data: { companyId, leadId: id, fromStageId: from?.id ?? null, toStageId: to.id, userId: ctx.user.id } }),
    ]);

    await this.audit.record({ companyId, entity: 'LEAD', entityId: id, action: 'STAGE_CHANGE', before: { stage: from?.name ?? null }, after: { stage: to.name, ...(reason && { lostReason: reason }) }, ctx });
    const ev: LeadStageChangedEvent = {
      companyId, leadId: id, userId: ctx.user.id, fromStageId: from?.id ?? null, toStageId: to.id, fromName: from?.name ?? null, toName: to.name, toType: to.type, lostReason: reason,
    };
    await this.emit(CrmEvents.LeadStageChanged, ev);
    if (firstTimeQualified) {
      const q: LeadQualifiedEvent = { companyId, leadId: id, userId: ctx.user.id, stageId: to.id, stageName: to.name };
      await this.emit(CrmEvents.LeadQualified, q);
    }
    return this.get(ctx.user, id);
  }

  async addNote(ctx: AuthedCtx, id: string, text: string) {
    await this.load(ctx.user, id);
    await this.prisma.timelineEvent.create({
      data: { companyId: ctx.user.companyId, leadId: id, type: 'NOTE_ADDED', userId: ctx.user.id, title: 'Anotação', description: text },
    });
    return this.get(ctx.user, id);
  }

  async remove(ctx: AuthedCtx, id: string) {
    const lead = await this.load(ctx.user, id);
    await this.prisma.lead.delete({ where: { id } });
    await this.audit.record({
      companyId: ctx.user.companyId, entity: 'LEAD', entityId: id, action: 'DELETE',
      before: { customer: lead.customer.name, stage: lead.stage?.name ?? null, source: lead.source }, ctx,
    });
  }
}
