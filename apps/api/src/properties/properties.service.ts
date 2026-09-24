import { Injectable } from '@nestjs/common';
import { slugify, type CreatePropertyInput, type ListPropertiesQuery, type UpdatePropertyInput } from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { blankToNull } from '../common/util';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const DECIMALS = [
  'salePrice', 'rentPrice', 'condominiumFee', 'propertyTax', 'minimumNegotiationPrice',
  'totalArea', 'usefulArea', 'builtArea', 'landArea',
] as const;

const include = {
  type: { select: { id: true, name: true } },
  broker: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, phone: true, whatsapp: true, email: true } },
  features: { include: { feature: { select: { id: true, name: true, category: true, icon: true } } } },
  media: { where: { isCover: true }, take: 1, select: { thumbnailKey: true, processedKey: true } },
  _count: { select: { media: true } },
} as const;

type Row = Record<string, any>;

const toNum = (v: unknown) => (v == null ? null : Number(v));

/** Valores monetários e áreas viram number; dados sensíveis só para quem edita imóveis. */
function present(p: Row, user: AuthedUser) {
  const out: Row = { ...p, features: p.features.map((f: Row) => f.feature) };
  for (const k of DECIMALS) out[k] = toNum(p[k]);
  if (!user.permissions.includes('property.edit')) {
    delete out.minimumNegotiationPrice;
    delete out.owner;
    delete out.ownerId;
  }
  return out;
}

/** Foto do registro para auditoria: colunas simples + ids das características. */
function snapshot(p: Row) {
  const { type, broker, branch, owner, features, media, _count, ...cols } = p;
  const out: Row = { ...cols };
  for (const k of DECIMALS) out[k] = toNum(p[k]);
  out.featureIds = features.map((f: Row) => f.featureId).sort();
  return sanitize(out);
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mediaService: MediaService,
  ) {}

  /** Resposta da API: adiciona a URL da capa (miniatura) e o total de mídias. */
  private out(p: Row, user: AuthedUser) {
    const o = present(p, user);
    const cover = p.media?.[0];
    const key = cover?.thumbnailKey ?? cover?.processedKey ?? null;
    o.coverUrl = key ? this.storage.publicUrl(key) : null;
    o.mediaCount = p._count?.media ?? 0;
    delete o.media;
    delete o._count;
    return o;
  }

  // ---------- Consultas ----------
  async list(user: AuthedUser, q: ListPropertiesQuery) {
    const AND: Row[] = [];
    if (q.search) {
      const c = { contains: q.search, mode: 'insensitive' as const };
      AND.push({ OR: [{ title: c }, { code: c }, { neighborhood: c }, { city: c }, { address: c }] });
    }
    if (q.priceMin != null || q.priceMax != null) {
      const range = { ...(q.priceMin != null && { gte: q.priceMin }), ...(q.priceMax != null && { lte: q.priceMax }) };
      AND.push({ OR: [{ salePrice: range }, { rentPrice: range }] });
    }
    const where = {
      companyId: user.companyId,
      ...(q.status && { status: q.status }),
      ...(q.purpose && { purpose: q.purpose }),
      ...(q.typeId && { typeId: q.typeId }),
      ...(q.brokerId && { brokerId: q.brokerId }),
      ...(q.ownerId && { ownerId: q.ownerId }),
      ...(q.city && { city: { equals: q.city, mode: 'insensitive' as const } }),
      ...(q.neighborhood && { neighborhood: { equals: q.neighborhood, mode: 'insensitive' as const } }),
      ...(q.published && { published: q.published === 'true' }),
      ...(q.bedrooms != null && { bedrooms: { gte: q.bedrooms } }),
      ...(AND.length && { AND }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.property.count({ where }),
    ]);
    return { items: rows.map((r) => this.out(r, user)), total, page: q.page, pageSize: q.pageSize };
  }

  async summary(companyId: string) {
    const [byStatus, published] = await Promise.all([
      this.prisma.property.groupBy({ by: ['status'], where: { companyId }, _count: true }),
      this.prisma.property.count({ where: { companyId, published: true } }),
    ]);
    const counts: Record<string, number> = { published };
    for (const r of byStatus) counts[r.status] = r._count;
    return counts;
  }

  /** Opções de formulário: quem pode ser corretor responsável (usuários ativos da empresa). */
  async options(companyId: string) {
    const brokers = await this.prisma.user.findMany({
      where: { companyId, status: 'ACTIVE', role: { key: { in: ['ADMIN', 'MANAGER', 'BROKER'] } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { brokers };
  }

  private async load(companyId: string, id: string) {
    const p = await this.prisma.property.findFirst({ where: { id, companyId }, include });
    if (!p) throw notFound('Imóvel não encontrado.');
    return p;
  }

  async get(user: AuthedUser, id: string) {
    return this.out(await this.load(user.companyId, id), user);
  }

  async history(user: AuthedUser, id: string) {
    await this.load(user.companyId, id);
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId: user.companyId, entity: 'PROPERTY', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, companyId: user.companyId }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, action: r.action, before: r.before, after: r.after, createdAt: r.createdAt, userName: r.userId ? (names.get(r.userId) ?? null) : null }));
  }

  // ---------- Validações ----------
  private async assertRefs(companyId: string, i: Partial<CreatePropertyInput>) {
    if (i.typeId && !(await this.prisma.propertyType.findFirst({ where: { id: i.typeId, companyId, active: true } }))) {
      throw new AppException('PROPERTY_TYPE_INVALID', 400);
    }
    if (i.ownerId && !(await this.prisma.owner.findFirst({ where: { id: i.ownerId, companyId } }))) {
      throw new AppException('OWNER_INVALID', 400);
    }
    if (i.brokerId && !(await this.prisma.user.findFirst({ where: { id: i.brokerId, companyId, status: 'ACTIVE' } }))) {
      throw new AppException('BROKER_INVALID', 400);
    }
    if (i.branchId && !(await this.prisma.branch.findFirst({ where: { id: i.branchId, companyId } }))) {
      throw new AppException('BRANCH_INVALID', 400);
    }
    if (i.featureIds?.length) {
      const n = await this.prisma.feature.count({ where: { id: { in: i.featureIds }, companyId } });
      if (n !== new Set(i.featureIds).size) throw new AppException('FEATURE_INVALID', 400);
    }
  }

  private assertPrices(v: { salePrice?: number | null; minimumNegotiationPrice?: number | null }) {
    if (v.salePrice != null && v.minimumNegotiationPrice != null && v.minimumNegotiationPrice > v.salePrice) {
      throw new AppException('PROPERTY_INVALID_PRICE', 400, 'O valor mínimo de negociação não pode ser maior que o valor de venda.');
    }
  }

  // ---------- Escrita ----------
  async create(ctx: AuthedCtx, input: CreatePropertyInput) {
    const { companyId } = ctx.user;
    await this.assertRefs(companyId, input);
    this.assertPrices(input);
    if (input.status === 'ARCHIVED') throw new AppException('PROPERTY_STATUS_INVALID', 400);

    const { featureIds = [], ...fields } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      const { propertySeq } = await tx.company.update({ where: { id: companyId }, data: { propertySeq: { increment: 1 } }, select: { propertySeq: true } });
      const code = `IM${String(propertySeq).padStart(4, '0')}`;
      return tx.property.create({
        data: {
          ...(blankToNull(fields) as object),
          companyId,
          code,
          slug: `${slugify(input.title)}-${code.toLowerCase()}`,
          status: input.status ?? 'DRAFT',
          brokerId: input.brokerId ?? ctx.user.id,
          branchId: input.branchId ?? ctx.user.branchId,
          features: { create: [...new Set(featureIds)].map((featureId) => ({ featureId })) },
        } as never,
        include,
      });
    });
    await this.audit.record({ companyId, entity: 'PROPERTY', entityId: created.id, action: 'CREATE', after: snapshot(created), ctx });
    return this.out(created, ctx.user);
  }

  async update(ctx: AuthedCtx, id: string, input: UpdatePropertyInput) {
    const { companyId } = ctx.user;
    const current = await this.load(companyId, id);
    await this.assertRefs(companyId, input);
    this.assertPrices({
      salePrice: input.salePrice !== undefined ? input.salePrice : toNum(current.salePrice),
      minimumNegotiationPrice: input.minimumNegotiationPrice !== undefined ? input.minimumNegotiationPrice : toNum(current.minimumNegotiationPrice),
    });
    if (input.status === 'ARCHIVED') throw new AppException('PROPERTY_STATUS_INVALID', 400);
    if (input.status === 'DRAFT' && current.published) {
      throw new AppException('PROPERTY_STATUS_INVALID', 400, 'Um imóvel publicado não pode voltar a rascunho. Despublique primeiro.');
    }

    const { featureIds, ...fields } = input;
    const data: Row = { ...blankToNull(fields) };
    // O endereço público (slug) não muda depois da primeira publicação, para não quebrar links e SEO.
    if (input.title && input.title !== current.title && !current.publishedAt) {
      data.slug = `${slugify(input.title)}-${current.code.toLowerCase()}`;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (featureIds) {
        await tx.propertyFeature.deleteMany({ where: { propertyId: id } });
        await tx.propertyFeature.createMany({ data: [...new Set(featureIds)].map((featureId) => ({ propertyId: id, featureId })) });
      }
      return tx.property.update({ where: { id }, data: data as never, include });
    });

    const d = diff(snapshot(current), snapshot(updated));
    if (d.changed) {
      await this.audit.record({ companyId, entity: 'PROPERTY', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    }
    return this.out(updated, ctx.user);
  }

  async publish(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const p = await this.load(companyId, id);
    const missing: { field: string; message: string }[] = [];
    const need = (ok: unknown, field: string, message: string) => { if (!ok) missing.push({ field, message }); };
    need(p.title, 'title', 'Informe o título.');
    need(p.city, 'city', 'Informe a cidade.');
    need(p.neighborhood, 'neighborhood', 'Informe o bairro.');
    if (p.purpose !== 'RENT') need(toNum(p.salePrice) && toNum(p.salePrice)! > 0, 'salePrice', 'Informe o valor de venda.');
    if (p.purpose !== 'SALE') need(toNum(p.rentPrice) && toNum(p.rentPrice)! > 0, 'rentPrice', 'Informe o valor do aluguel.');
    need(await this.prisma.propertyMedia.count({ where: { propertyId: id, type: 'IMAGE', status: { not: 'FAILED' } } }), 'media', 'Adicione ao menos uma foto do imóvel.');
    if (missing.length) throw new AppException('PROPERTY_INCOMPLETE', 422, missing[0]!.message, missing);

    const updated = await this.prisma.property.update({
      where: { id },
      data: {
        published: true,
        publishedAt: p.publishedAt ?? new Date(),
        status: p.status === 'DRAFT' || p.status === 'ARCHIVED' ? 'AVAILABLE' : p.status,
      },
      include,
    });
    await this.audit.record({
      companyId, entity: 'PROPERTY', entityId: id, action: 'PUBLISH',
      before: { published: p.published, status: p.status }, after: { published: true, status: updated.status }, ctx,
    });
    return this.out(updated, ctx.user);
  }

  async unpublish(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const p = await this.load(companyId, id);
    const updated = await this.prisma.property.update({ where: { id }, data: { published: false }, include });
    await this.audit.record({ companyId, entity: 'PROPERTY', entityId: id, action: 'UNPUBLISH', before: { published: p.published }, after: { published: false }, ctx });
    return this.out(updated, ctx.user);
  }

  async archive(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const p = await this.load(companyId, id);
    const updated = await this.prisma.property.update({ where: { id }, data: { status: 'ARCHIVED', published: false }, include });
    await this.audit.record({
      companyId, entity: 'PROPERTY', entityId: id, action: 'ARCHIVE',
      before: { status: p.status, published: p.published }, after: { status: 'ARCHIVED', published: false }, ctx,
    });
    return this.out(updated, ctx.user);
  }

  async remove(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const p = await this.load(companyId, id);
    if (p.status !== 'DRAFT' || p.publishedAt) throw new AppException('PROPERTY_NOT_DELETABLE', 409);
    await this.mediaService.purgeFiles(companyId, id);
    await this.prisma.property.delete({ where: { id } });
    await this.audit.record({ companyId, entity: 'PROPERTY', entityId: id, action: 'DELETE', before: snapshot(p), ctx });
  }
}
