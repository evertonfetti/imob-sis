import { Injectable } from '@nestjs/common';
import {
  slugify,
  type PublicCompany, type PublicLeadInput, type PublicListQuery, type PublicPropertyCard, type PublicPropertyDetail,
  type WhatsappClickInput,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { ReqCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PublicCompanyService } from './public-company.service';

/** O que aparece no site: publicado e ainda disponível (ou reservado). Vendidos/alugados só pela URL direta. */
const LISTED = ['AVAILABLE', 'RESERVED'] as const;

const num = (v: unknown) => (v == null ? null : Number(v));
const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim().slice(0, 500) : null);

/** Telefone só com dígitos e sem o código do país (55). */
export function normalizePhone(v: string) {
  let d = v.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}

const coverInclude = {
  type: { select: { name: true } },
  media: { where: { isCover: true, status: 'READY' as const }, take: 1, select: { thumbnailKey: true, processedKey: true } },
} as const;

type CardRow = Record<string, any>;

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly company: PublicCompanyService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Apresentação ----------
  private card(p: CardRow): PublicPropertyCard {
    const cover = p.media?.[0];
    const url = (k?: string | null) => (k ? this.storage.publicUrl(k) : null);
    return {
      id: p.id, code: p.code, slug: p.slug, title: p.title, shortDescription: p.shortDescription, purpose: p.purpose, status: p.status,
      type: p.type.name, subtype: p.subtype,
      salePrice: num(p.salePrice), rentPrice: num(p.rentPrice), condominiumFee: num(p.condominiumFee),
      bedrooms: p.bedrooms, suites: p.suites, bathrooms: p.bathrooms, parkingSpaces: p.parkingSpaces,
      totalArea: num(p.totalArea), usefulArea: num(p.usefulArea),
      neighborhood: p.neighborhood, city: p.city, state: p.state, featured: p.featured,
      coverUrl: url(cover?.thumbnailKey ?? cover?.processedKey), coverFullUrl: url(cover?.processedKey ?? cover?.thumbnailKey),
      publishedAt: p.publishedAt?.toISOString() ?? null,
    };
  }

  // ---------- Empresa ----------
  async getCompany(): Promise<PublicCompany> {
    const id = await this.company.id();
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id } });
    const branch = await this.prisma.branch.findFirst({ where: { companyId: id, active: true }, orderBy: { createdAt: 'asc' } });
    const address = branch ? [branch.address, branch.city && branch.state ? `${branch.city}/${branch.state}` : branch.city].filter(Boolean).join(' · ') : null;
    return {
      name: c.name, tradeName: c.tradeName, creci: c.creci, email: c.email ?? branch?.email ?? null,
      phone: c.phone ?? branch?.phone ?? null, whatsapp: c.whatsapp ?? branch?.whatsapp ?? null,
      website: c.website, logoUrl: c.logoUrl, primaryColor: c.primaryColor, address: address || null,
    };
  }

  // ---------- Imóveis ----------
  private async visibleWhere(companyId: string) {
    return { companyId, published: true, status: { in: [...LISTED] } };
  }

  async list(q: PublicListQuery) {
    const companyId = await this.company.id();
    const AND: Record<string, any>[] = [];
    const priceField = q.purpose === 'RENT' ? 'rentPrice' : q.purpose === 'SALE' ? 'salePrice' : null;

    if (q.purpose) AND.push({ purpose: { in: [q.purpose, 'SALE_AND_RENT'] } });
    if (q.priceMin != null || q.priceMax != null) {
      const range = { ...(q.priceMin != null && { gte: q.priceMin }), ...(q.priceMax != null && { lte: q.priceMax }) };
      AND.push(priceField ? { [priceField]: range } : { OR: [{ salePrice: range }, { rentPrice: range }] });
    }
    if (q.areaMin != null || q.areaMax != null) {
      const range = { ...(q.areaMin != null && { gte: q.areaMin }), ...(q.areaMax != null && { lte: q.areaMax }) };
      AND.push({ OR: [{ totalArea: range }, { usefulArea: range }, { builtArea: range }] });
    }
    if (q.q) {
      const c = { contains: q.q, mode: 'insensitive' as const };
      AND.push({ OR: [{ title: c }, { code: c }, { neighborhood: c }, { city: c }] });
    }
    if (q.type) {
      const types = await this.prisma.propertyType.findMany({ where: { companyId }, select: { id: true, name: true } });
      const ids = types.filter((t) => slugify(t.name) === q.type).map((t) => t.id);
      AND.push({ typeId: { in: ids } }); // slug desconhecido → nenhum resultado
    }
    if (q.features) {
      const slugs = q.features.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
      const feats = await this.prisma.feature.findMany({ where: { companyId, slug: { in: slugs } }, select: { id: true } });
      if (feats.length !== slugs.length) AND.push({ id: { in: [] } });
      else for (const f of feats) AND.push({ features: { some: { featureId: f.id } } });
    }

    const where = {
      ...(await this.visibleWhere(companyId)),
      ...(q.city && { city: { equals: q.city, mode: 'insensitive' as const } }),
      ...(q.neighborhood && { neighborhood: { equals: q.neighborhood, mode: 'insensitive' as const } }),
      ...(q.bedrooms != null && { bedrooms: { gte: q.bedrooms } }),
      ...(q.suites != null && { suites: { gte: q.suites } }),
      ...(q.parkingSpaces != null && { parkingSpaces: { gte: q.parkingSpaces } }),
      ...(q.featured && { featured: true }),
      ...(AND.length && { AND }),
    };
    const col = q.purpose === 'RENT' ? 'rentPrice' : 'salePrice';
    const orderBy: any[] =
      q.sort === 'price_asc' ? [{ [col]: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }]
      : q.sort === 'price_desc' ? [{ [col]: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }]
      : [{ publishedAt: 'desc' }];

    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({ where, include: coverInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.property.count({ where }),
    ]);
    return { items: rows.map((r) => this.card(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async detail(slug: string): Promise<PublicPropertyDetail> {
    const companyId = await this.company.id();
    // Publicado é suficiente: vendido/alugado continuam acessíveis pela URL (SEO), com aviso no site.
    const p = await this.prisma.property.findFirst({
      where: { companyId, slug, published: true },
      include: {
        ...coverInclude,
        broker: { select: { name: true, creci: true } },
        features: { include: { feature: { select: { id: true, name: true, category: true } } }, orderBy: { feature: { name: 'asc' } } },
        media: { where: { status: 'READY', type: { in: ['IMAGE', 'FLOOR_PLAN', 'VIDEO'] } }, orderBy: { position: 'asc' } },
      },
    });
    if (!p) throw notFound('Imóvel não encontrado.');

    const exact = p.showExactAddress;
    const similar = await this.prisma.property.findMany({
      where: {
        ...(await this.visibleWhere(companyId)), id: { not: p.id },
        OR: [{ city: p.city, typeId: p.typeId }, { city: p.city, neighborhood: p.neighborhood }],
      },
      include: coverInclude, orderBy: { publishedAt: 'desc' }, take: 3,
    });

    const cover = p.media.find((m) => m.isCover) ?? p.media.find((m) => m.type === 'IMAGE');
    const base = this.card({ ...p, media: cover ? [cover] : [] });
    return {
      ...base,
      description: p.description, propertyTax: num(p.propertyTax), builtArea: num(p.builtArea), landArea: num(p.landArea),
      // Sem "endereço exato": nada de rua, número, CEP ou coordenadas na resposta.
      address: exact ? p.address : null, number: exact ? p.number : null, complement: exact ? p.complement : null,
      zipCode: exact ? p.zipCode : null, latitude: exact ? p.latitude : null, longitude: exact ? p.longitude : null,
      showExactAddress: exact, updatedAt: p.updatedAt.toISOString(),
      features: p.features.map((f) => f.feature),
      media: p.media
        .filter((m) => m.type === 'VIDEO' || m.contentType.startsWith('image/'))
        .map((m) => ({
          id: m.id, type: m.type, caption: m.caption, width: m.width, height: m.height,
          url: this.storage.publicUrl(m.processedKey ?? m.originalKey),
          thumbnailUrl: m.thumbnailKey ? this.storage.publicUrl(m.thumbnailKey) : null,
        })),
      broker: p.broker,
      similar: similar.map((s) => this.card(s)),
    };
  }

  /** Opções dos filtros, calculadas só com o que está no ar. */
  async filters() {
    const companyId = await this.company.id();
    const where = await this.visibleWhere(companyId);
    const [types, allTypes, cities, hoods, feats, features, prices] = await Promise.all([
      this.prisma.property.groupBy({ by: ['typeId'], where, _count: true }),
      this.prisma.propertyType.findMany({ where: { companyId }, select: { id: true, name: true } }),
      this.prisma.property.groupBy({ by: ['city'], where: { ...where, city: { not: null } }, _count: true, orderBy: { city: 'asc' } }),
      this.prisma.property.groupBy({ by: ['city', 'neighborhood'], where: { ...where, neighborhood: { not: null } }, _count: true, orderBy: { neighborhood: 'asc' } }),
      this.prisma.propertyFeature.groupBy({ by: ['featureId'], where: { property: where }, _count: true }),
      this.prisma.feature.findMany({ where: { companyId, active: true }, select: { id: true, name: true, slug: true, category: true } }),
      this.prisma.property.aggregate({ where, _min: { salePrice: true, rentPrice: true }, _max: { salePrice: true, rentPrice: true } }),
    ]);
    const typeName = new Map(allTypes.map((t) => [t.id, t.name]));
    const featCount = new Map(feats.map((f) => [f.featureId, f._count]));
    return {
      types: types.map((t) => ({ name: typeName.get(t.typeId)!, slug: slugify(typeName.get(t.typeId)!), count: t._count })).sort((a, b) => a.name.localeCompare(b.name)),
      cities: cities.map((c) => ({ name: c.city!, count: c._count })),
      neighborhoods: hoods.map((h) => ({ name: h.neighborhood!, city: h.city, count: h._count })),
      features: features.filter((f) => featCount.has(f.id)).map((f) => ({ name: f.name, slug: f.slug, category: f.category, count: featCount.get(f.id)! })),
      price: {
        sale: { min: num(prices._min.salePrice), max: num(prices._max.salePrice) },
        rent: { min: num(prices._min.rentPrice), max: num(prices._max.rentPrice) },
      },
    };
  }

  async sitemap() {
    const companyId = await this.company.id();
    const rows = await this.prisma.property.findMany({
      where: { companyId, published: true }, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: 'desc' }, take: 5000,
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }

  // ---------- Formulário de interesse ----------
  async createLead(input: PublicLeadInput, ctx: ReqCtx) {
    if (input.website) return { ok: true }; // robô: finge sucesso e descarta
    const companyId = await this.company.id();

    const property = input.propertyId
      ? await this.prisma.property.findFirst({ where: { id: input.propertyId, companyId, published: true } })
      : null;
    if (input.propertyId && !property) throw new AppException('LEAD_PROPERTY_INVALID', 400);

    const phone = normalizePhone(input.phone);
    const email = input.email || null;

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({
        where: { companyId, OR: [{ phone }, ...(email ? [{ email }] : [])] },
        orderBy: { createdAt: 'asc' },
      });
      const customer = existing
        ? await tx.customer.update({ where: { id: existing.id }, data: { email: existing.email ?? email, whatsapp: existing.whatsapp ?? phone } })
        : await tx.customer.create({ data: { companyId, name: input.name, email, phone, whatsapp: phone } });

      // Reenvios do mesmo interesse em 24h não geram lead duplicado.
      const since = new Date(Date.now() - 24 * 3_600_000);
      const dup = await tx.lead.findFirst({ where: { companyId, customerId: customer.id, propertyId: property?.id ?? null, createdAt: { gte: since } } });
      if (dup) return { leadId: dup.id, created: false };

      const lead = await tx.lead.create({
        data: {
          companyId, customerId: customer.id, propertyId: property?.id ?? null,
          brokerId: property?.brokerId ?? null,
          source: 'SITE', status: 'NEW', notes: clean(input.message),
          purpose: property?.purpose ?? null, city: property?.city ?? null, neighborhood: property?.neighborhood ?? null,
          bedrooms: property?.bedrooms ?? null, consentAt: new Date(),
          attribution: {
            create: {
              utmSource: clean(input.utmSource), utmMedium: clean(input.utmMedium), utmCampaign: clean(input.utmCampaign),
              utmContent: clean(input.utmContent), utmTerm: clean(input.utmTerm),
              fbclid: clean(input.fbclid), fbc: clean(input.fbc), fbp: clean(input.fbp), gclid: clean(input.gclid),
              landingPage: clean(input.landingPage), referrer: clean(input.referrer),
              campaignId: clean(input.campaignId), adsetId: clean(input.adsetId), adId: clean(input.adId),
            },
          },
        },
      });
      return { leadId: lead.id, created: true, customerId: customer.id };
    });

    if (result.created) {
      await this.audit.record({
        companyId, userId: null, entity: 'LEAD', entityId: result.leadId, action: 'CREATE',
        after: { source: 'SITE', propertyId: property?.id ?? null, propertyCode: property?.code ?? null }, ctx,
      });
    }
    return { ok: true };
  }

  async whatsappClick(input: WhatsappClickInput) {
    const companyId = await this.company.id();
    const property = input.propertyId
      ? await this.prisma.property.findFirst({ where: { id: input.propertyId, companyId, published: true }, select: { id: true } })
      : null;
    await this.prisma.whatsAppClick.create({
      data: {
        companyId, propertyId: property?.id ?? null, sessionId: clean(input.sessionId), visitorId: clean(input.visitorId),
        utmSource: clean(input.utmSource), utmMedium: clean(input.utmMedium), utmCampaign: clean(input.utmCampaign),
        utmContent: clean(input.utmContent), utmTerm: clean(input.utmTerm),
        fbclid: clean(input.fbclid), fbc: clean(input.fbc), fbp: clean(input.fbp), gclid: clean(input.gclid),
        landingPage: clean(input.landingPage), referrer: clean(input.referrer),
      },
    });
  }
}
