import { Injectable } from '@nestjs/common';
import { type LeadMatchDto, type MatchResult, type PropertyMatchDto } from '@imob/types';
import type { AuthedUser } from '../common/request-context';
import { notFound } from '../common/app-exception';
import { StorageService } from '../storage/storage.service';
import { IntelligenceSettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

type Purpose = 'SALE' | 'RENT' | 'SALE_AND_RENT';
export interface MatchCriteria {
  purpose: Purpose | null; budgetMin: number | null; budgetMax: number | null; city: string | null; neighborhood: string | null;
  bedrooms: number | null; typeId: string | null; featureIds: string[];
}
export interface Candidate {
  id: string; purpose: Purpose; typeId: string; city: string | null; neighborhood: string | null; bedrooms: number | null;
  salePrice: number | null; rentPrice: number | null; minimumNegotiationPrice: number | null; featureIds: string[];
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const num = (v: unknown) => (v == null ? null : Number(v));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const compatiblePurposes = (p: Purpose | null): Purpose[] | null => (p === 'SALE' ? ['SALE', 'SALE_AND_RENT'] : p === 'RENT' ? ['RENT', 'SALE_AND_RENT'] : null);

/**
 * Pontua um imóvel para um lead (0–100). Só entram no cálculo os critérios que o lead informou:
 * a nota é (pontos obtidos ÷ pontos possíveis). `null` = descartado (finalidade incompatível, outra cidade ou muito acima do orçamento).
 */
export function scoreMatch(c: MatchCriteria, p: Candidate): { score: number; reasons: string[]; criteria: string[]; weight: number } | null {
  const okPurposes = compatiblePurposes(c.purpose);
  if (okPurposes && !okPurposes.includes(p.purpose)) return null;

  const reasons: string[] = [];
  const criteria: string[] = [];
  let got = 0;
  let possible = 0;
  const add = (label: string, max: number, points: number, reason?: string) => { criteria.push(label); possible += max; got += points; if (reason && points > 0) reasons.push(reason); };

  if (c.budgetMin != null || c.budgetMax != null) {
    const price = c.purpose === 'RENT' ? p.rentPrice : (p.salePrice ?? p.rentPrice);
    if (price == null) add('orçamento', 30, 0);
    else if (c.budgetMax != null && price > c.budgetMax * 1.25) return null;
    else if (c.budgetMax != null && price > c.budgetMax) {
      const negotiable = p.minimumNegotiationPrice != null && p.minimumNegotiationPrice <= c.budgetMax;
      const within10 = price <= c.budgetMax * 1.1;
      add('orçamento', 30, negotiable ? 22 : within10 ? 15 : 6, negotiable ? 'Cabe no orçamento com negociação' : within10 ? `Até 10% acima do orçamento (${brl(price)})` : `Acima do orçamento (${brl(price)})`);
    } else if (c.budgetMin != null && price < c.budgetMin * 0.7) add('orçamento', 30, 15, `Abaixo do orçamento (${brl(price)})`);
    else add('orçamento', 30, 30, `Dentro do orçamento (${brl(price)})`);
  }
  // Cidade é decisiva: outra cidade é outro mercado, então descarta em vez de só perder pontos.
  if (c.city) { if (norm(c.city) !== norm(p.city)) return null; add('cidade', 15, 15, `Mesma cidade (${p.city})`); }
  if (c.neighborhood) add('bairro', 10, norm(c.neighborhood) === norm(p.neighborhood) ? 10 : 0, `Mesmo bairro (${p.neighborhood})`);
  if (c.bedrooms != null) {
    const d = (p.bedrooms ?? -99) - c.bedrooms;
    const pts = d === 0 ? 15 : d === 1 ? 12 : d > 1 ? 8 : d === -1 ? 6 : 0;
    add('dormitórios', 15, pts, d === 0 ? `${p.bedrooms} dormitórios, como pediu` : d > 0 ? `${p.bedrooms} dormitórios (mais que o pedido)` : `${p.bedrooms} dormitórios (um a menos)`);
  }
  if (c.typeId) add('tipo', 10, c.typeId === p.typeId ? 10 : 0, 'Mesmo tipo de imóvel');
  if (c.featureIds.length) {
    const shared = c.featureIds.filter((f) => p.featureIds.includes(f)).length;
    add('características', 10, Math.round((10 * shared) / c.featureIds.length), shared ? `${shared} de ${c.featureIds.length} características em comum` : undefined);
  }
  if (okPurposes) reasons.unshift(c.purpose === 'RENT' ? 'Disponível para locação' : 'Disponível para venda');
  return { score: possible ? Math.round((got / possible) * 100) : 0, reasons, criteria, weight: possible };
}

/** Mínimo de informação para a comparação fazer sentido (orçamento vale sozinho; senão, ao menos 25 pontos). */
const ENOUGH_WEIGHT = 25;
const staticWeight = (c: MatchCriteria) => (c.budgetMin != null || c.budgetMax != null ? 30 : 0) + (c.city ? 15 : 0) + (c.neighborhood ? 10 : 0) + (c.bedrooms != null ? 15 : 0) + (c.typeId ? 10 : 0) + (c.featureIds.length ? 10 : 0);

const candidateSelect = {
  id: true, code: true, title: true, purpose: true, typeId: true, city: true, neighborhood: true, bedrooms: true, salePrice: true, rentPrice: true, minimumNegotiationPrice: true,
  features: { select: { featureId: true } },
  media: { where: { type: 'IMAGE' as const, isCover: true }, take: 1, select: { thumbnailKey: true, processedKey: true } },
} as const;

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly settings: IntelligenceSettingsService) {}

  private cover(m?: { thumbnailKey: string | null; processedKey: string | null }) {
    const key = m?.thumbnailKey ?? m?.processedKey ?? null;
    return key ? this.storage.publicUrl(key) : null;
  }

  private async interestOf(companyId: string, propertyId: string | null) {
    return propertyId ? this.prisma.property.findFirst({ where: { id: propertyId, companyId }, select: { purpose: true, typeId: true, features: { select: { featureId: true } } } }) : null;
  }

  private criteriaOf(lead: { purpose: Purpose | null; budgetMin: unknown; budgetMax: unknown; city: string | null; neighborhood: string | null; bedrooms: number | null }, interest: { purpose: string; typeId: string; features: { featureId: string }[] } | null | undefined): MatchCriteria {
    // Tipo e características vêm do imóvel pelo qual o lead demonstrou interesse.
    return {
      purpose: lead.purpose ?? (interest && interest.purpose !== 'SALE_AND_RENT' ? interest.purpose as Purpose : null),
      budgetMin: num(lead.budgetMin), budgetMax: num(lead.budgetMax), city: lead.city, neighborhood: lead.neighborhood, bedrooms: lead.bedrooms,
      typeId: interest?.typeId ?? null, featureIds: interest?.features.map((f) => f.featureId) ?? [],
    };
  }

  /** Imóveis compatíveis com um lead (spec §38 `matchLeadToProperties`). */
  async matchLeadToProperties(companyId: string, leadId: string, opts: { limit?: number; minScore?: number; scope?: object } = {}): Promise<MatchResult<PropertyMatchDto>> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, companyId, ...(opts.scope ?? {}) } });
    if (!lead) throw notFound('Lead não encontrado.');
    const minScore = opts.minScore ?? (await this.settings.get(companyId)).matchMinScore;
    const c = this.criteriaOf(lead, await this.interestOf(companyId, lead.propertyId));
    const purposes = compatiblePurposes(c.purpose);
    const rows = await this.prisma.property.findMany({
      where: { companyId, status: 'AVAILABLE', published: true, ...(lead.propertyId && { id: { not: lead.propertyId } }), ...(purposes && { purpose: { in: purposes } }) },
      select: candidateSelect, orderBy: { publishedAt: 'desc' }, take: 400,
    });
    const items: PropertyMatchDto[] = [];
    for (const r of rows) {
      const m = scoreMatch(c, this.candidate(r));
      if (!m) continue;
      if (m.score >= minScore) {
        const price = c.purpose === 'RENT' ? num(r.rentPrice) : (num(r.salePrice) ?? num(r.rentPrice));
        items.push({ propertyId: r.id, score: m.score, reasons: m.reasons, property: { id: r.id, code: r.code, title: r.title, purpose: r.purpose, city: r.city, neighborhood: r.neighborhood, bedrooms: r.bedrooms, price, coverUrl: this.cover(r.media[0]) } });
      }
    }
    items.sort((a, b) => b.score - a.score);
    const known = staticWeight(c) >= ENOUGH_WEIGHT;
    return { items: known ? items.slice(0, opts.limit ?? 8) : [], criteria: this.describe(c), insufficientData: !known };
  }

  /** Leads em aberto que combinam com um imóvel (mesma pontuação, no sentido inverso). */
  async matchPropertyToLeads(companyId: string, propertyId: string, opts: { limit?: number; minScore?: number; scope?: object } = {}): Promise<MatchResult<LeadMatchDto>> {
    const p = await this.prisma.property.findFirst({ where: { id: propertyId, companyId: companyId }, select: candidateSelect });
    if (!p) throw notFound('Imóvel não encontrado.');
    const cand = this.candidate(p);
    const minScore = opts.minScore ?? (await this.settings.get(companyId)).matchMinScore;
    const leads = await this.prisma.lead.findMany({
      where: { companyId: companyId, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] }, ...(opts.scope ?? {}) },
      include: { customer: { select: { name: true } }, broker: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 500,
    });
    const interests = new Map((await this.prisma.property.findMany({ where: { companyId, id: { in: leads.map((l) => l.propertyId).filter((x): x is string => !!x) } }, select: { id: true, purpose: true, typeId: true, features: { select: { featureId: true } } } })).map((p) => [p.id, p]));
    const items: LeadMatchDto[] = [];
    for (const l of leads) {
      if (l.propertyId === propertyId) continue;
      const m = scoreMatch(this.criteriaOf(l, l.propertyId ? interests.get(l.propertyId) : null), cand);
      if (m && m.weight >= ENOUGH_WEIGHT && m.score >= minScore) {
        items.push({ leadId: l.id, score: m.score, reasons: m.reasons, lead: { id: l.id, customerName: l.customer.name, brokerName: l.broker?.name ?? null, status: l.status, scoreValue: l.score } });
      }
    }
    items.sort((a, b) => b.score - a.score || b.lead.scoreValue - a.lead.scoreValue);
    return { items: items.slice(0, opts.limit ?? 8), criteria: [], insufficientData: false };
  }

  private describe(c: MatchCriteria) {
    return [c.budgetMin != null || c.budgetMax != null ? 'orçamento' : '', c.city ? 'cidade' : '', c.neighborhood ? 'bairro' : '', c.bedrooms != null ? 'dormitórios' : '', c.typeId ? 'tipo' : ''].filter(Boolean);
  }

  private candidate(r: { id: string; purpose: string; typeId: string; city: string | null; neighborhood: string | null; bedrooms: number | null; salePrice: unknown; rentPrice: unknown; minimumNegotiationPrice: unknown; features: { featureId: string }[] }): Candidate {
    return { id: r.id, purpose: r.purpose as Purpose, typeId: r.typeId, city: r.city, neighborhood: r.neighborhood, bedrooms: r.bedrooms, salePrice: num(r.salePrice), rentPrice: num(r.rentPrice), minimumNegotiationPrice: num(r.minimumNegotiationPrice), featureIds: r.features.map((f) => f.featureId) };
  }
}
