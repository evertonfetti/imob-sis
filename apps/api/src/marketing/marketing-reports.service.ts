import { Injectable } from '@nestjs/common';
import { Prisma } from '@imob/database';
import type { CampaignRow, SourceRow } from '@imob/types';
import { PrismaService } from '../prisma/prisma.service';

const TZ = 'America/Sao_Paulo';
const n = (v: unknown) => Number(v ?? 0);
const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

// "Qualificado" = o lead passou por alguma etapa marcada como qualificadora (histórico de etapas, não a etapa atual).
const QUALIFIED = Prisma.sql`EXISTS (SELECT 1 FROM lead_stage_history h JOIN pipeline_stages s ON s.id = h."toStageId" WHERE h."leadId" = l.id AND s.qualifies)`;

/** Relatórios de origem e campanhas: respondem "quais campanhas geram leads realmente bons". */
@Injectable()
export class MarketingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private since(days: number) { return new Date(Date.now() - days * 86_400_000); }

  async campaigns(companyId: string, days: number): Promise<CampaignRow[]> {
    const since = this.since(days);
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT COALESCE(NULLIF(lower(trim(a."utmCampaign")), ''), '(sem campanha)') AS campaign,
             COALESCE(NULLIF(lower(trim(a."utmSource")), ''), '(direto / sem origem)') AS source,
             COALESCE(NULLIF(lower(trim(a."utmMedium")), ''), '') AS medium,
             count(*) AS leads,
             count(*) FILTER (WHERE ${QUALIFIED}) AS qualified,
             count(*) FILTER (WHERE l.status = 'WON') AS won,
             count(*) FILTER (WHERE l.status = 'LOST') AS lost,
             COALESCE(sum(CASE WHEN l.status = 'WON' AND p.purpose <> 'RENT' THEN p."salePrice" END), 0) AS "wonValue"
      FROM leads l
      LEFT JOIN lead_attributions a ON a."leadId" = l.id
      LEFT JOIN properties p ON p.id = l."propertyId"
      WHERE l."companyId" = ${companyId} AND l."createdAt" >= ${since}
      GROUP BY 1, 2, 3`;
    const clicks = await this.prisma.$queryRaw<any[]>`
      SELECT COALESCE(NULLIF(lower(trim("utmCampaign")), ''), '(sem campanha)') AS campaign,
             COALESCE(NULLIF(lower(trim("utmSource")), ''), '(direto / sem origem)') AS source,
             COALESCE(NULLIF(lower(trim("utmMedium")), ''), '') AS medium, count(*) AS clicks
      FROM whatsapp_clicks WHERE "companyId" = ${companyId} AND "createdAt" >= ${since} GROUP BY 1, 2, 3`;
    const key = (r: { campaign: string; source: string; medium: string }) => `${r.campaign}|${r.source}|${r.medium}`;
    const map = new Map<string, CampaignRow>();
    for (const r of rows) {
      const leads = n(r.leads);
      map.set(key(r), {
        campaign: r.campaign, source: r.source, medium: r.medium, leads, qualified: n(r.qualified), won: n(r.won), lost: n(r.lost),
        whatsappClicks: 0, wonValue: n(r.wonValue), qualifiedRate: rate(n(r.qualified), leads), wonRate: rate(n(r.won), leads),
      });
    }
    for (const c of clicks) {
      const k = key(c);
      const cur = map.get(k) ?? { campaign: c.campaign, source: c.source, medium: c.medium, leads: 0, qualified: 0, won: 0, lost: 0, whatsappClicks: 0, wonValue: 0, qualifiedRate: 0, wonRate: 0 };
      cur.whatsappClicks = n(c.clicks);
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.leads - a.leads || b.whatsappClicks - a.whatsappClicks);
  }

  async sources(companyId: string, days: number): Promise<{ channels: SourceRow[]; utm: SourceRow[] }> {
    const since = this.since(days);
    const fold = (rows: any[], label: (k: string) => string): SourceRow[] =>
      rows.map((r) => {
        const leads = n(r.leads);
        return { key: r.k, label: label(r.k), leads, qualified: n(r.qualified), won: n(r.won), qualifiedRate: rate(n(r.qualified), leads), wonRate: rate(n(r.won), leads) };
      });
    const channels = await this.prisma.$queryRaw<any[]>`
      SELECT l.source::text AS k, count(*) AS leads, count(*) FILTER (WHERE ${QUALIFIED}) AS qualified, count(*) FILTER (WHERE l.status = 'WON') AS won
      FROM leads l WHERE l."companyId" = ${companyId} AND l."createdAt" >= ${since} GROUP BY 1 ORDER BY leads DESC`;
    const utm = await this.prisma.$queryRaw<any[]>`
      SELECT COALESCE(NULLIF(lower(trim(a."utmSource")), ''), '(direto / sem origem)') AS k, count(*) AS leads,
             count(*) FILTER (WHERE ${QUALIFIED}) AS qualified, count(*) FILTER (WHERE l.status = 'WON') AS won
      FROM leads l LEFT JOIN lead_attributions a ON a."leadId" = l.id
      WHERE l."companyId" = ${companyId} AND l."createdAt" >= ${since} GROUP BY 1 ORDER BY leads DESC`;
    return { channels: fold(channels, (k) => k), utm: fold(utm, (k) => k) };
  }

  async overview(companyId: string, days: number) {
    const since = this.since(days);
    const [tot] = await this.prisma.$queryRaw<any[]>`
      SELECT count(*) AS leads, count(*) FILTER (WHERE ${QUALIFIED}) AS qualified, count(*) FILTER (WHERE l.status = 'WON') AS won,
             count(*) FILTER (WHERE l.status = 'LOST') AS lost
      FROM leads l WHERE l."companyId" = ${companyId} AND l."createdAt" >= ${since}`;
    // As datas ficam no banco em UTC (sem fuso). Convertemos para o horário de Brasília antes de agrupar por dia.
    const perDay = await this.prisma.$queryRaw<any[]>`
      SELECT to_char(timezone(${TZ}, timezone('UTC', l."createdAt")), 'YYYY-MM-DD') AS day, count(*) AS leads
      FROM leads l WHERE l."companyId" = ${companyId} AND l."createdAt" >= ${since} GROUP BY 1`;
    const counts = new Map(perDay.map((r) => [r.day as string, n(r.leads)]));
    const dayKey = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: TZ }); // AAAA-MM-DD
    const series: { day: string; leads: number }[] = [];
    for (let i = days; i >= 0; i--) {
      const key = dayKey(new Date(Date.now() - i * 86_400_000));
      if (!series.some((s) => s.day === key)) series.push({ day: key, leads: counts.get(key) ?? 0 });
    }
    const clicks = await this.prisma.whatsAppClick.count({ where: { companyId, createdAt: { gte: since } } });
    const events = await this.prisma.marketingEvent.groupBy({ by: ['status'], where: { companyId, createdAt: { gte: since } }, _count: true });
    const leads = n(tot?.leads);
    return {
      days, leads, qualified: n(tot?.qualified), won: n(tot?.won), lost: n(tot?.lost), whatsappClicks: clicks,
      qualifiedRate: rate(n(tot?.qualified), leads), wonRate: rate(n(tot?.won), leads),
      series,
      events: Object.fromEntries(events.map((e) => [e.status, e._count])) as Record<string, number>,
    };
  }
}
