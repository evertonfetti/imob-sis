import { Injectable } from '@nestjs/common';
import {
  DEFAULT_INTELLIGENCE_SETTINGS, resolveIntelligenceSettings, settingsConflict,
  type IntelligenceInsights, type IntelligenceSettings, type IntelligenceSettingsDto, type UpdateIntelligenceSettingsInput,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const H = 3_600_000;
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Limites de alertas e automações comerciais, por empresa (o que não foi ajustado usa o padrão). */
@Injectable()
export class IntelligenceSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(companyId: string): Promise<IntelligenceSettings> {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { intelligenceSettings: true } });
    return resolveIntelligenceSettings(c?.intelligenceSettings);
  }

  async dto(companyId: string): Promise<IntelligenceSettingsDto> {
    return { settings: await this.get(companyId), defaults: DEFAULT_INTELLIGENCE_SETTINGS, insights: await this.insights(companyId) };
  }

  async update(ctx: AuthedCtx, input: UpdateIntelligenceSettingsInput | { reset: true }) {
    const { companyId } = ctx.user;
    const before = await this.get(companyId);
    const next = 'reset' in input ? DEFAULT_INTELLIGENCE_SETTINGS : { ...before, ...input };
    const conflict = settingsConflict(next);
    if (conflict) throw new AppException('VALIDATION_FAILED', 400, conflict);
    await this.prisma.company.update({ where: { id: companyId }, data: { intelligenceSettings: next } });
    await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'UPDATE', before: { intelligence: before }, after: { intelligence: next }, ctx });
    return this.dto(companyId);
  }

  /**
   * Medido nos próprios dados: quanto tempo os leads costumam ficar em cada etapa (últimos 180 dias).
   * Serve de régua para escolher limites que sinalizem o que é realmente fora do normal.
   */
  async insights(companyId: string): Promise<IntelligenceInsights> {
    const since = new Date(Date.now() - 180 * 24 * H);
    const [stages, rows] = await Promise.all([
      this.prisma.pipelineStage.findMany({ where: { pipeline: { companyId } }, select: { id: true, position: true, type: true } }),
      this.prisma.leadStageHistory.findMany({ where: { companyId, createdAt: { gte: since } }, orderBy: [{ leadId: 'asc' }, { createdAt: 'asc' }], select: { leadId: true, toStageId: true, createdAt: true }, take: 100_000 }),
    ]);
    const info = new Map(stages.map((s) => [s.id, s]));
    const first: number[] = [];
    const other: number[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i]!; const next = rows[i + 1]!;
      if (cur.leadId !== next.leadId) continue; // só permanências que terminaram
      const st = info.get(cur.toStageId);
      if (!st || st.type !== 'OPEN') continue;
      const hours = (next.createdAt.getTime() - cur.createdAt.getTime()) / H;
      (st.position === 0 ? first : other).push(hours);
    }
    const summarize = (xs: number[], unit: number, d: number) => {
      if (xs.length < 5) return null;
      const s = [...xs].sort((a, b) => a - b);
      return { median: round(pct(s, 0.5) / unit, d), p80: round(pct(s, 0.8) / unit, d), samples: s.length };
    };
    return { firstStageHours: summarize(first, 1, 1), otherStagesDays: summarize(other, 24, 1) };
  }
}
