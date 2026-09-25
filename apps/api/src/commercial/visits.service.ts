import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ACTIVE_VISIT_STATUSES, type CreateVisitInput, type UpdateVisitInput, type VisitStatus } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { canViewAll } from '../crm/visibility';
import { PrismaService } from '../prisma/prisma.service';
import { CommercialEvents, type VisitEvent } from './commercial.events';

const include = {
  lead: { select: { id: true, brokerId: true, customer: { select: { id: true, name: true, phone: true } } } },
  property: { select: { id: true, code: true, title: true, neighborhood: true, city: true, status: true } },
  broker: { select: { id: true, name: true } },
} as const;

const FROM: Record<VisitStatus, VisitStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};
const HOUR = 3_600_000;

/** Corretores só enxergam as visitas dele (ou dos leads dele); quem tem `lead.view_all` vê todas. */
export const visitScope = (u: AuthedUser) => ({
  companyId: u.companyId,
  ...(canViewAll(u) ? {} : { OR: [{ brokerId: u.id }, { lead: { brokerId: u.id } }] }),
});

@Injectable()
export class VisitsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly events: EventEmitter2) {}

  private async emit(name: string, e: VisitEvent) {
    try { await this.events.emitAsync(name, e); } catch { /* a automação nunca derruba a operação principal */ }
  }

  async list(user: AuthedUser, q: { page: number; pageSize: number; from?: string; to?: string; brokerId?: string; status?: string; leadId?: string; propertyId?: string }) {
    const where = {
      ...visitScope(user),
      ...((q.from || q.to) && { scheduledAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(q.to) }) } }),
      ...(q.brokerId && { brokerId: q.brokerId === 'me' ? user.id : q.brokerId }),
      ...(q.status && { status: q.status as VisitStatus }),
      ...(q.leadId && { leadId: q.leadId }),
      ...(q.propertyId && { propertyId: q.propertyId }),
    };
    const [items, total] = await Promise.all([
      this.prisma.visit.findMany({ where, include, orderBy: { scheduledAt: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.visit.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  private async load(user: AuthedUser, id: string) {
    const v = await this.prisma.visit.findFirst({ where: { id, ...visitScope(user) }, include });
    if (!v) throw notFound('Visita não encontrada.');
    return v;
  }
  get(user: AuthedUser, id: string) { return this.load(user, id); }

  /** Visitas ativas do corretor que se sobrepõem ao intervalo pedido. */
  private async conflicts(brokerId: string, start: Date, minutes: number, ignoreId?: string) {
    const end = new Date(start.getTime() + minutes * 60_000);
    const near = await this.prisma.visit.findMany({
      where: { brokerId, status: { in: ACTIVE_VISIT_STATUSES }, id: { not: ignoreId }, scheduledAt: { gte: new Date(start.getTime() - 8 * HOUR), lt: end } },
      include: { lead: { select: { customer: { select: { name: true } } } }, property: { select: { code: true } } },
    });
    return near.filter((v) => v.scheduledAt.getTime() + v.durationMinutes * 60_000 > start.getTime())
      .map((v) => ({ id: v.id, scheduledAt: v.scheduledAt.toISOString(), durationMinutes: v.durationMinutes, customer: v.lead.customer.name, propertyCode: v.property.code }));
  }

  private async assertBroker(user: AuthedUser, brokerId: string) {
    if (!(await this.prisma.user.findFirst({ where: { id: brokerId, companyId: user.companyId, status: 'ACTIVE' }, select: { id: true } }))) throw new AppException('LEAD_BROKER_INVALID', 400);
    if (!canViewAll(user) && brokerId !== user.id) throw new AppException('AUTH_FORBIDDEN', 403); // corretor agenda só para si
  }

  async create(ctx: AuthedCtx, input: CreateVisitInput) {
    const { user } = ctx;
    const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, companyId: user.companyId, ...(canViewAll(user) ? {} : { brokerId: user.id }) }, select: { id: true, propertyId: true, brokerId: true } });
    if (!lead) throw notFound('Lead não encontrado.');
    const propertyId = input.propertyId ?? lead.propertyId;
    if (!propertyId) throw new AppException('VISIT_PROPERTY_REQUIRED', 400);
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, companyId: user.companyId }, select: { id: true, code: true, status: true } });
    if (!property) throw new AppException('PROPERTY_INVALID', 400);
    if (!['AVAILABLE', 'RESERVED'].includes(property.status)) throw new AppException('VISIT_PROPERTY_UNAVAILABLE', 409);

    const brokerId = input.brokerId ?? lead.brokerId ?? user.id;
    await this.assertBroker(user, brokerId);
    const start = new Date(input.scheduledAt);
    if (start.getTime() < Date.now() - HOUR) throw new AppException('VISIT_PAST', 400);
    const clash = await this.conflicts(brokerId, start, input.durationMinutes);
    if (clash.length && !input.force) throw new AppException('VISIT_CONFLICT', 409, undefined, clash);

    const visit = await this.prisma.visit.create({
      data: { companyId: user.companyId, leadId: lead.id, propertyId, brokerId, scheduledAt: start, durationMinutes: input.durationMinutes, notes: input.notes || null, createdById: user.id },
      include,
    });
    await this.audit.record({ companyId: user.companyId, entity: 'VISIT', entityId: visit.id, action: 'CREATE', after: { leadId: lead.id, propertyId, brokerId, scheduledAt: start, forced: !!(clash.length && input.force) }, ctx });
    await this.emit(CommercialEvents.VisitScheduled, { companyId: user.companyId, leadId: lead.id, userId: user.id, visitId: visit.id, brokerId, brokerName: visit.broker.name, scheduledAt: start, propertyCode: property.code });
    return visit;
  }

  async update(ctx: AuthedCtx, id: string, input: UpdateVisitInput) {
    const { user } = ctx;
    const cur = await this.load(user, id);
    const timeChange = input.scheduledAt !== undefined || input.durationMinutes !== undefined || input.brokerId !== undefined || input.propertyId !== undefined;

    if (cur.status === 'CANCELLED' || cur.status === 'NO_SHOW') throw new AppException('VISIT_STATUS_INVALID', 409);
    if (cur.status === 'COMPLETED' && (timeChange || (input.status && input.status !== 'COMPLETED'))) throw new AppException('VISIT_STATUS_INVALID', 409); // depois de realizada, só notas e feedback

    const data: Record<string, unknown> = {};
    let next: VisitStatus = cur.status;
    if (input.status && input.status !== cur.status) {
      if (!FROM[cur.status].includes(input.status)) throw new AppException('VISIT_STATUS_INVALID', 409);
      // "Realizada" e "não compareceu" só fazem sentido depois do horário (ou pouco antes, se o cliente chegou cedo).
      if ((input.status === 'COMPLETED' || input.status === 'NO_SHOW') && cur.scheduledAt.getTime() > Date.now() + 30 * 60_000) {
        throw new AppException('VISIT_STATUS_INVALID', 409, 'A visita ainda não aconteceu.');
      }
      next = input.status;
    }

    let start = cur.scheduledAt;
    let minutes = cur.durationMinutes;
    let brokerId = cur.brokerId;
    if (timeChange && cur.status !== 'COMPLETED') {
      if (input.scheduledAt) { start = new Date(input.scheduledAt); if (start.getTime() < Date.now() - HOUR) throw new AppException('VISIT_PAST', 400); }
      if (input.durationMinutes) minutes = input.durationMinutes;
      if (input.brokerId) { await this.assertBroker(user, input.brokerId); brokerId = input.brokerId; }
      if (input.propertyId && input.propertyId !== cur.propertyId) {
        const p = await this.prisma.property.findFirst({ where: { id: input.propertyId, companyId: user.companyId }, select: { status: true } });
        if (!p) throw new AppException('PROPERTY_INVALID', 400);
        if (!['AVAILABLE', 'RESERVED'].includes(p.status)) throw new AppException('VISIT_PROPERTY_UNAVAILABLE', 409);
        data.propertyId = input.propertyId;
      }
      const changed = start.getTime() !== cur.scheduledAt.getTime() || minutes !== cur.durationMinutes || brokerId !== cur.brokerId;
      if (changed && (next === 'SCHEDULED' || next === 'CONFIRMED')) {
        const clash = await this.conflicts(brokerId, start, minutes, id);
        if (clash.length && !input.force) throw new AppException('VISIT_CONFLICT', 409, undefined, clash);
        Object.assign(data, { scheduledAt: start, durationMinutes: minutes, brokerId });
        if (cur.status === 'CONFIRMED' && next === 'CONFIRMED') { next = 'SCHEDULED'; data.confirmedAt = null; } // o horário mudou: a confirmação deixou de valer
      }
    }

    if (input.notes !== undefined) data.notes = input.notes || null;
    if (input.feedback !== undefined) data.feedback = input.feedback || null;
    if (next !== cur.status) {
      data.status = next;
      if (next === 'CONFIRMED') data.confirmedAt = new Date();
      if (next === 'COMPLETED') data.completedAt = new Date();
      if (next === 'CANCELLED' || next === 'NO_SHOW') data.cancelReason = input.cancelReason || null;
    }
    if (!Object.keys(data).length) return cur;

    const updated = await this.prisma.visit.update({ where: { id }, data, include });
    const rescheduled = 'scheduledAt' in data || 'brokerId' in data;
    await this.audit.record({
      companyId: user.companyId, entity: 'VISIT', entityId: id, action: next !== cur.status ? `STATUS_${next}` : rescheduled ? 'RESCHEDULE' : 'UPDATE',
      before: { status: cur.status, scheduledAt: cur.scheduledAt, brokerId: cur.brokerId }, after: { status: updated.status, scheduledAt: updated.scheduledAt, brokerId: updated.brokerId }, ctx,
    });
    const ev: VisitEvent = { companyId: user.companyId, leadId: cur.leadId, userId: user.id, visitId: id, brokerId: updated.brokerId, brokerName: updated.broker.name, scheduledAt: updated.scheduledAt, propertyCode: updated.property.code };
    if (next !== cur.status && next === 'COMPLETED') await this.emit(CommercialEvents.VisitCompleted, ev);
    else if (next !== cur.status && (next === 'CANCELLED' || next === 'NO_SHOW')) await this.emit(CommercialEvents.VisitCancelled, { ...ev, kind: next });
    else if (rescheduled) await this.emit(CommercialEvents.VisitRescheduled, ev);
    return updated;
  }
}
