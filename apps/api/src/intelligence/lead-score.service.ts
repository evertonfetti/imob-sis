import { Injectable, Logger } from '@nestjs/common';
import { HOT_SCORE, LEAD_SCORE_FACTORS, LEAD_SCORE_MAX, temperatureOf, type LeadScoreDto, type LeadScoreFactorKey } from '@imob/types';
import { PrismaService } from '../prisma/prisma.service';

/** Score por regras (spec §37): soma dos fatores que o lead cumpre, limitado a 100. Sem IA. */
@Injectable()
export class LeadScoreService {
  private readonly log = new Logger('LeadScore');
  constructor(private readonly prisma: PrismaService) {}

  /** Quais fatores o lead cumpre hoje. */
  private async earned(companyId: string, leadId: string): Promise<Set<LeadScoreFactorKey> | null> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId }, select: { budgetMin: true, budgetMax: true } });
    if (!lead) return null;
    const [inbound, visits, proposals] = await Promise.all([
      this.prisma.conversation.count({ where: { companyId, leadId, lastInboundAt: { not: null } } }),
      this.prisma.visit.groupBy({ by: ['status'], where: { companyId, leadId }, _count: true }),
      this.prisma.proposal.count({ where: { companyId, leadId, status: { in: ['SENT', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED'] } } }),
    ]);
    const has = (...st: string[]) => visits.some((v) => st.includes(v.status));
    const set = new Set<LeadScoreFactorKey>();
    if (lead.budgetMin || lead.budgetMax) set.add('BUDGET');
    if (inbound) set.add('WHATSAPP');
    if (visits.length) set.add('VISIT_REQUESTED');
    if (has('SCHEDULED', 'CONFIRMED', 'COMPLETED')) set.add('VISIT_SCHEDULED');
    if (has('COMPLETED')) set.add('VISIT_DONE');
    if (proposals) set.add('PROPOSAL');
    return set;
  }

  async explain(companyId: string, leadId: string): Promise<LeadScoreDto | null> {
    const set = await this.earned(companyId, leadId);
    if (!set) return null;
    const score = Math.min(LEAD_SCORE_MAX, LEAD_SCORE_FACTORS.filter((f) => set.has(f.key)).reduce((n, f) => n + f.points, 0));
    return { score, temperature: temperatureOf(score), factors: LEAD_SCORE_FACTORS.map((f) => ({ key: f.key, label: f.label, points: f.points, earned: set.has(f.key) })) };
  }

  /** Recalcula e grava. Retorna o score anterior e o novo (para detectar "virou quente"). */
  async recompute(companyId: string, leadId: string): Promise<{ before: number; after: number; crossedHot: boolean } | null> {
    const dto = await this.explain(companyId, leadId);
    if (!dto) return null;
    const cur = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { score: true } });
    const before = cur?.score ?? 0;
    await this.prisma.lead.update({ where: { id: leadId }, data: { score: dto.score, scoreUpdatedAt: new Date() } });
    return { before, after: dto.score, crossedHot: before < HOT_SCORE && dto.score >= HOT_SCORE };
  }

  /** Preenche leads nunca calculados (leads antigos e qualquer falha de evento). */
  async backfill(batch = 200): Promise<number> {
    const rows = await this.prisma.lead.findMany({ where: { scoreUpdatedAt: null }, select: { id: true, companyId: true }, take: batch });
    for (const r of rows) {
      try { await this.recompute(r.companyId, r.id); } catch (e) { this.log.warn(`score do lead ${r.id}: ${(e as Error).message}`); }
    }
    return rows.length;
  }
}
