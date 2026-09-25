import { Injectable } from '@nestjs/common';
import { ACTIVE_VISIT_STATUSES, OPEN_PROPOSAL_STATUSES } from '@imob/types';
import type { AuthedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { proposalScope } from './proposals.service';
import { visitScope } from './visits.service';

const DAY = 86_400_000;

/** Números do painel comercial (respeita o escopo: corretor vê só os dele). */
@Injectable()
export class CommercialSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthedUser) {
    const now = new Date();
    const vScope = visitScope(user);
    const pScope = proposalScope(user);
    const [visitsToday, visitsWeek, noShowMonth, openProposals, accepted, next] = await Promise.all([
      this.prisma.visit.count({ where: { ...vScope, status: { in: ACTIVE_VISIT_STATUSES }, scheduledAt: { gte: startOfDay(now), lt: new Date(startOfDay(now).getTime() + DAY) } } }),
      this.prisma.visit.count({ where: { ...vScope, status: { in: ACTIVE_VISIT_STATUSES }, scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } } }),
      this.prisma.visit.count({ where: { ...vScope, status: 'NO_SHOW', scheduledAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
      this.prisma.proposal.aggregate({ where: { ...pScope, status: { in: OPEN_PROPOSAL_STATUSES as never[] } }, _count: true, _sum: { proposedPrice: true } }),
      this.prisma.proposal.aggregate({ where: { ...pScope, status: 'ACCEPTED' }, _count: true, _sum: { proposedPrice: true } }),
      this.prisma.visit.findMany({
        where: { ...vScope, status: { in: ACTIVE_VISIT_STATUSES }, scheduledAt: { gte: now } }, orderBy: { scheduledAt: 'asc' }, take: 5,
        select: { id: true, scheduledAt: true, status: true, lead: { select: { id: true, customer: { select: { name: true } } } }, property: { select: { code: true, title: true } } },
      }),
    ]);
    return {
      visitsToday, visitsWeek, noShowMonth,
      openProposals: { count: openProposals._count, value: Number(openProposals._sum.proposedPrice ?? 0) },
      acceptedProposals: { count: accepted._count, value: Number(accepted._sum.proposedPrice ?? 0) },
      nextVisits: next.map((v) => ({ id: v.id, scheduledAt: v.scheduledAt.toISOString(), status: v.status, leadId: v.lead.id, customerName: v.lead.customer.name, propertyCode: v.property.code, propertyTitle: v.property.title })),
    };
  }
}

function startOfDay(d: Date) {
  // Dia comercial em São Paulo (UTC-3, sem horário de verão desde 2019).
  const sp = new Date(d.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()) + 3 * 3_600_000);
}
