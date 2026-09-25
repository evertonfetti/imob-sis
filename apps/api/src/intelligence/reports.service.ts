import { Injectable } from '@nestjs/common';
import type { ReportOverviewDto, ReportQuery } from '@imob/types';
import type { AuthedUser } from '../common/request-context';
import { canViewAll, leadScope } from '../crm/visibility';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;
const SP_OFFSET = 3 * 3_600_000; // America/Sao_Paulo = UTC-3 (sem horário de verão)
const num = (v: unknown) => (v == null ? 0 : Number(v));
const dayKey = (d: Date) => new Date(d.getTime() - SP_OFFSET).toISOString().slice(0, 10);

/** Início do dia (São Paulo) em UTC. */
const startOfDay = (d: Date) => new Date(Date.parse(`${dayKey(d)}T00:00:00.000Z`) + SP_OFFSET);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(q: ReportQuery) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(startOfDay(to).getTime() - 29 * DAY);
    // Limita a 366 dias para o relatório continuar leve.
    return { from: to.getTime() - from.getTime() > 366 * DAY ? new Date(to.getTime() - 366 * DAY) : from, to };
  }

  async overview(user: AuthedUser, q: ReportQuery): Promise<ReportOverviewDto> {
    const { from, to } = this.range(q);
    const scope = leadScope(user);
    const inRange = { gte: from, lte: to };
    const cohort = { ...scope, createdAt: inRange };
    const viaLead = { lead: scope };

    const [newLeads, openLeads, wonRows, lostLeads, bySource, wonBySource, created, stages, history, byProperty, lostReasons, visitsDone, proposals, deals] = await Promise.all([
      this.prisma.lead.count({ where: cohort }),
      this.prisma.lead.count({ where: { ...scope, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } } }),
      this.prisma.lead.findMany({ where: { ...cohort, status: 'WON' }, select: { createdAt: true, closedAt: true } }),
      this.prisma.lead.count({ where: { ...scope, status: 'LOST', closedAt: inRange } }),
      this.prisma.lead.groupBy({ by: ['source'], where: cohort, _count: true }),
      this.prisma.lead.groupBy({ by: ['source'], where: { ...cohort, status: 'WON' }, _count: true }),
      this.prisma.lead.findMany({ where: cohort, select: { createdAt: true }, take: 50_000 }),
      this.prisma.pipelineStage.findMany({ where: { pipeline: { companyId: user.companyId } }, orderBy: { position: 'asc' } }),
      this.prisma.leadStageHistory.findMany({ where: { companyId: user.companyId, lead: cohort }, distinct: ['leadId', 'toStageId'], select: { leadId: true, toStageId: true }, take: 100_000 }),
      this.prisma.lead.groupBy({ by: ['propertyId'], where: { ...cohort, propertyId: { not: null } }, _count: true, orderBy: { _count: { propertyId: 'desc' } }, take: 8 }),
      this.prisma.lead.groupBy({ by: ['lostReason'], where: { ...scope, status: 'LOST', closedAt: inRange, lostReason: { not: null } }, _count: true, orderBy: { _count: { lostReason: 'desc' } }, take: 6 }),
      this.prisma.visit.count({ where: { companyId: user.companyId, ...viaLead, status: 'COMPLETED', completedAt: inRange } }),
      this.prisma.proposal.count({ where: { companyId: user.companyId, ...viaLead, createdAt: inRange, status: { not: 'DRAFT' } } }),
      this.prisma.proposal.aggregate({ where: { companyId: user.companyId, ...viaLead, status: 'ACCEPTED', decidedAt: inRange }, _sum: { proposedPrice: true } }),
    ]);

    // Leads por dia (com dias sem lead preenchidos com zero).
    const perDay = new Map<string, number>();
    for (const c of created) perDay.set(dayKey(c.createdAt), (perDay.get(dayKey(c.createdAt)) ?? 0) + 1);
    const byDay: { date: string; leads: number }[] = [];
    for (let t = startOfDay(from).getTime(); t <= to.getTime(); t += DAY) { const k = dayKey(new Date(t)); byDay.push({ date: k, leads: perDay.get(k) ?? 0 }); }

    // Funil: quantos leads da coorte chegaram a cada etapa ou além (leads podem pular etapas, então o número nunca sobe ao descer o funil).
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const furthest = new Map<string, number>();
    for (const h of history) {
      const st = stageById.get(h.toStageId);
      if (st && st.type !== 'LOST') furthest.set(h.leadId, Math.max(furthest.get(h.leadId) ?? -1, st.position));
    }
    const funnel = stages.filter((s) => s.type !== 'LOST').map((s) => ({ stageId: s.id, name: s.name, color: s.color, reached: [...furthest.values()].filter((pos) => pos >= s.position).length }));

    const wonMap = new Map(wonBySource.map((w) => [w.source, w._count]));
    const days = wonRows.filter((w) => w.closedAt).map((w) => (w.closedAt!.getTime() - w.createdAt.getTime()) / DAY);

    // Imóveis mais procurados: leads + visitas + propostas por imóvel.
    const propIds = byProperty.map((p) => p.propertyId!).filter(Boolean);
    const [props, visitsBy, proposalsBy] = propIds.length ? await Promise.all([
      this.prisma.property.findMany({ where: { id: { in: propIds }, companyId: user.companyId }, select: { id: true, code: true, title: true } }),
      this.prisma.visit.groupBy({ by: ['propertyId'], where: { companyId: user.companyId, ...viaLead, propertyId: { in: propIds }, createdAt: inRange }, _count: true }),
      this.prisma.proposal.groupBy({ by: ['propertyId'], where: { companyId: user.companyId, ...viaLead, propertyId: { in: propIds }, createdAt: inRange }, _count: true }),
    ]) : [[], [], []];
    const pInfo = new Map(props.map((p) => [p.id, p]));
    const vMap = new Map(visitsBy.map((v) => [v.propertyId, v._count]));
    const prMap = new Map(proposalsBy.map((v) => [v.propertyId, v._count]));

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        newLeads, wonLeads: wonRows.length, lostLeads, openLeads,
        conversionRate: newLeads ? wonRows.length / newLeads : 0,
        avgDaysToClose: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
        visitsDone, proposals, dealValue: num(deals._sum.proposedPrice),
      },
      bySource: bySource.map((s) => ({ source: s.source, leads: s._count, won: wonMap.get(s.source) ?? 0 })).sort((a, b) => b.leads - a.leads),
      byDay, funnel,
      topProperties: byProperty.filter((p) => pInfo.has(p.propertyId!)).map((p) => ({ propertyId: p.propertyId!, code: pInfo.get(p.propertyId!)!.code, title: pInfo.get(p.propertyId!)!.title, leads: p._count, visits: vMap.get(p.propertyId!) ?? 0, proposals: prMap.get(p.propertyId!) ?? 0 })),
      lostReasons: lostReasons.map((r) => ({ reason: r.lostReason!, count: r._count })),
      brokers: canViewAll(user) ? await this.brokers(user.companyId, from, to) : null,
    };
  }

  private async brokers(companyId: string, from: Date, to: Date) {
    const inRange = { gte: from, lte: to };
    const [leads, won, visits, proposals, users] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['brokerId'], where: { companyId, createdAt: inRange }, _count: true, _avg: { score: true } }),
      this.prisma.lead.groupBy({ by: ['brokerId'], where: { companyId, createdAt: inRange, status: 'WON' }, _count: true }),
      this.prisma.visit.groupBy({ by: ['brokerId'], where: { companyId, status: 'COMPLETED', completedAt: inRange }, _count: true }),
      this.prisma.proposal.groupBy({ by: ['createdById'], where: { companyId, createdAt: inRange, status: { not: 'DRAFT' } }, _count: true }),
      this.prisma.user.findMany({ where: { companyId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    const by = <T extends { _count: number }>(rows: T[], key: (r: T) => string | null) => new Map(rows.map((r) => [key(r), r._count]));
    const wonM = by(won, (r) => (r as never as { brokerId: string | null }).brokerId);
    const visM = by(visits, (r) => (r as never as { brokerId: string | null }).brokerId);
    const prM = by(proposals, (r) => (r as never as { createdById: string | null }).createdById);
    return leads.map((l) => ({
      brokerId: l.brokerId, name: l.brokerId ? (names.get(l.brokerId) ?? 'Ex-usuário') : 'Sem responsável', leads: l._count,
      visitsDone: visM.get(l.brokerId) ?? 0, proposals: prM.get(l.brokerId) ?? 0, won: wonM.get(l.brokerId) ?? 0, avgScore: Math.round(l._avg.score ?? 0),
    })).sort((a, b) => b.won - a.won || b.leads - a.leads);
  }
}
