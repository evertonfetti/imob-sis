import { Inject, Injectable } from '@nestjs/common';
import { INSTAGRAM_CAPTION_MAX, SOCIAL_MAX_DAYS_AHEAD, type CreateSocialPostInput, type SocialPostDto, type UpdateSocialPostInput } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SocialPublisher } from './social-publisher.service';

const brl = (v: unknown) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));

/** Corta o texto no fim de uma frase/palavra, sem passar de `max` caracteres. */
function clip(text: string, max: number) {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return `${(stop > max * 0.6 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' '))).trim()}…`;
}

const include = {
  property: { select: { id: true, code: true, title: true } },
  targets: { include: { account: { select: { id: true, provider: true, name: true } } }, orderBy: { account: { provider: 'asc' } } },
} as const;

@Injectable()
export class SocialPostsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly publisher: SocialPublisher,
  ) {}

  // ---------- Composição: tudo pré-preenchido, falta só a data ----------
  async composer(user: AuthedUser, propertyId: string) {
    const p = await this.prisma.property.findFirst({ where: { id: propertyId, companyId: user.companyId }, include: { media: { where: { type: 'IMAGE', status: 'READY' }, orderBy: { position: 'asc' } } } });
    if (!p) throw notFound('Imóvel não encontrado.');
    const facts = [
      p.bedrooms != null && `${p.bedrooms} dorm.`, p.suites != null && `${p.suites} ${p.suites === 1 ? 'suíte' : 'suítes'}`,
      p.parkingSpaces != null && `${p.parkingSpaces} ${p.parkingSpaces === 1 ? 'vaga' : 'vagas'}`,
      (p.usefulArea ?? p.totalArea) != null && `${Number(p.usefulArea ?? p.totalArea)} m²`,
    ].filter(Boolean) as string[];
    const prices = [
      p.purpose !== 'RENT' && p.salePrice != null && `💰 ${brl(p.salePrice)}`,
      p.purpose !== 'SALE' && p.rentPrice != null && `💰 ${brl(p.rentPrice)}/mês`,
    ].filter(Boolean) as string[];
    const site = this.env.SITE_URL?.replace(/\/$/, '');
    const link = p.published && site ? `🔗 ${site}/imovel/${p.slug}` : null;
    const where = [p.neighborhood, p.city].filter(Boolean).join(', ');
    const head = [p.title, [where && `📍 ${where}`, ...prices].filter(Boolean).join('\n'), facts.length ? `🛏 ${facts.join(' · ')}` : ''].filter(Boolean).join('\n\n');
    const foot = [link, `Cód. ${p.code}`].filter(Boolean).join('\n');
    const description = clip(p.description ?? p.shortDescription ?? '', Math.max(0, 1800 - head.length - foot.length));
    const caption = [head, description, foot].filter(Boolean).join('\n\n');
    const covers = p.media.filter((m) => m.isCover);
    return {
      property: { id: p.id, code: p.code, title: p.title, slug: p.slug, published: p.published },
      caption,
      media: [...covers, ...p.media.filter((m) => !m.isCover)].map((m) => ({ id: m.id, isCover: m.isCover, thumbnailUrl: m.thumbnailKey ? this.storage.publicUrl(m.thumbnailKey) : null, url: m.processedKey ? this.storage.publicUrl(m.processedKey) : null })),
    };
  }

  // ---------- Validação ----------
  private async validate(companyId: string, userId: string, propertyId: string, i: { mediaIds: string[]; accountIds: string[]; caption: string; scheduledAt?: string | null }) {
    const mediaIds = [...new Set(i.mediaIds)];
    const media = await this.prisma.propertyMedia.count({ where: { id: { in: mediaIds }, propertyId, companyId, type: 'IMAGE', status: 'READY' } });
    if (media !== mediaIds.length) throw new AppException('SOCIAL_MEDIA_INVALID', 400);
    const accountIds = [...new Set(i.accountIds)];
    const accounts = await this.prisma.socialAccount.findMany({ where: { id: { in: accountIds }, companyId, status: 'ACTIVE', OR: [{ connectedById: userId }, { shared: true }] } }); // só contas suas ou compartilhadas
    if (accounts.length !== accountIds.length) throw new AppException('SOCIAL_ACCOUNT_INVALID', 400);
    if (accounts.some((a) => a.provider === 'INSTAGRAM') && i.caption.length > INSTAGRAM_CAPTION_MAX) throw new AppException('SOCIAL_INSTAGRAM_CAPTION', 400);
    let when = new Date();
    if (i.scheduledAt) {
      when = new Date(i.scheduledAt);
      if (when.getTime() < Date.now() - 60_000 || when.getTime() > Date.now() + SOCIAL_MAX_DAYS_AHEAD * 86_400_000) throw new AppException('SOCIAL_SCHEDULE_INVALID', 400);
    }
    return { mediaIds, accountIds, when, immediate: !i.scheduledAt };
  }

  // ---------- Operações ----------
  async create(ctx: AuthedCtx, input: CreateSocialPostInput) {
    const { companyId } = ctx.user;
    if (!(await this.prisma.property.findFirst({ where: { id: input.propertyId, companyId }, select: { id: true } }))) throw notFound('Imóvel não encontrado.');
    const v = await this.validate(companyId, ctx.user.id, input.propertyId, input);
    const post = await this.prisma.socialPost.create({
      data: {
        companyId, propertyId: input.propertyId, createdById: ctx.user.id, caption: input.caption, mediaIds: v.mediaIds, scheduledAt: v.when,
        targets: { create: v.accountIds.map((accountId) => ({ accountId })) },
      },
    });
    await this.audit.record({ companyId, entity: 'SOCIAL_POST', entityId: post.id, action: v.immediate ? 'PUBLISH_NOW' : 'SCHEDULE', after: { propertyId: input.propertyId, scheduledAt: v.when, accounts: v.accountIds.length, photos: v.mediaIds.length }, ctx });
    if (v.immediate) this.publisher.kick();
    return this.get(ctx.user, post.id);
  }

  private async load(user: AuthedUser, id: string) {
    const p = await this.prisma.socialPost.findFirst({ where: { id, companyId: user.companyId }, include });
    if (!p) throw notFound('Publicação não encontrada.');
    return p;
  }

  async update(ctx: AuthedCtx, id: string, input: UpdateSocialPostInput) {
    const { companyId } = ctx.user;
    const cur = await this.load(ctx.user, id);
    if (cur.status !== 'SCHEDULED') throw new AppException('SOCIAL_POST_LOCKED', 409);
    const v = await this.validate(companyId, ctx.user.id, cur.propertyId, {
      mediaIds: input.mediaIds ?? cur.mediaIds, accountIds: input.accountIds ?? cur.targets.map((t) => t.accountId),
      caption: input.caption ?? cur.caption, scheduledAt: input.scheduledAt === undefined ? cur.scheduledAt.toISOString() : input.scheduledAt,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.update({ where: { id }, data: { caption: input.caption ?? cur.caption, mediaIds: v.mediaIds, scheduledAt: v.when } });
      if (input.accountIds) {
        await tx.socialPostTarget.deleteMany({ where: { postId: id, accountId: { notIn: v.accountIds } } });
        for (const accountId of v.accountIds) await tx.socialPostTarget.upsert({ where: { postId_accountId: { postId: id, accountId } }, update: {}, create: { postId: id, accountId } });
      }
    });
    await this.audit.record({ companyId, entity: 'SOCIAL_POST', entityId: id, action: 'UPDATE', before: { scheduledAt: cur.scheduledAt }, after: { scheduledAt: v.when }, ctx });
    if (v.immediate) this.publisher.kick();
    return this.get(ctx.user, id);
  }

  async cancel(ctx: AuthedCtx, id: string) {
    const cur = await this.load(ctx.user, id);
    // A trava evita cancelar no meio de uma publicação: o resultado seria imprevisível.
    const res = await this.prisma.socialPost.updateMany({ where: { id, companyId: ctx.user.companyId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    if (res.count === 0) throw new AppException('SOCIAL_POST_LOCKED', 409);
    await this.audit.record({ companyId: ctx.user.companyId, entity: 'SOCIAL_POST', entityId: id, action: 'CANCEL', before: { status: cur.status, scheduledAt: cur.scheduledAt }, ctx });
    return this.get(ctx.user, id);
  }

  async publishNow(ctx: AuthedCtx, id: string) {
    const res = await this.prisma.socialPost.updateMany({ where: { id, companyId: ctx.user.companyId, status: 'SCHEDULED' }, data: { scheduledAt: new Date() } });
    if (res.count === 0) { await this.load(ctx.user, id); throw new AppException('SOCIAL_POST_LOCKED', 409); }
    await this.audit.record({ companyId: ctx.user.companyId, entity: 'SOCIAL_POST', entityId: id, action: 'PUBLISH_NOW', ctx });
    this.publisher.kick();
    return this.get(ctx.user, id);
  }

  async retryTarget(ctx: AuthedCtx, postId: string, targetId: string) {
    const post = await this.load(ctx.user, postId);
    const t = post.targets.find((x) => x.id === targetId);
    if (!t) throw notFound('Destino não encontrado.');
    if (t.status !== 'FAILED' || post.status === 'CANCELLED' || post.status === 'PUBLISHING') throw new AppException('SOCIAL_TARGET_NOT_RETRYABLE', 409);
    await this.prisma.$transaction([
      this.prisma.socialPostTarget.update({ where: { id: targetId }, data: { status: 'PENDING', attempts: 0, error: null, retryable: false, nextAttemptAt: null } }),
      this.prisma.socialPost.update({ where: { id: postId }, data: { status: 'SCHEDULED', scheduledAt: new Date(), publishedAt: null } }),
    ]);
    this.publisher.kick();
    return this.get(ctx.user, postId);
  }

  // ---------- Consulta ----------
  private async toDto(user: AuthedUser, rows: Awaited<ReturnType<SocialPostsService['load']>>[]): Promise<SocialPostDto[]> {
    const mediaIds = [...new Set(rows.flatMap((r) => r.mediaIds))];
    const media = mediaIds.length ? await this.prisma.propertyMedia.findMany({ where: { id: { in: mediaIds }, companyId: user.companyId } }) : [];
    const byId = new Map(media.map((m) => [m.id, m]));
    const authorIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const authors = authorIds.length ? await this.prisma.user.findMany({ where: { id: { in: authorIds }, companyId: user.companyId }, select: { id: true, name: true } }) : [];
    const names = new Map(authors.map((a) => [a.id, a.name]));
    return rows.map((r) => ({
      id: r.id, propertyId: r.propertyId, property: r.property, caption: r.caption, status: r.status, scheduledAt: r.scheduledAt.toISOString(), publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(), createdBy: r.createdById ? (names.get(r.createdById) ?? null) : null,
      media: r.mediaIds.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m).map((m) => ({ id: m.id, thumbnailUrl: m.thumbnailKey ? this.storage.publicUrl(m.thumbnailKey) : null, url: m.processedKey ? this.storage.publicUrl(m.processedKey) : null })),
      targets: r.targets.map((t) => ({
        id: t.id, accountId: t.accountId, provider: t.account.provider, accountName: t.account.name, status: t.status, permalink: t.permalink, error: t.error,
        retryable: t.retryable, attempts: t.attempts, nextAttemptAt: t.nextAttemptAt?.toISOString() ?? null,
      })),
    }));
  }

  async get(user: AuthedUser, id: string) {
    return (await this.toDto(user, [await this.load(user, id)]))[0]!;
  }

  async list(user: AuthedUser, q: { page: number; pageSize: number; view?: 'scheduled' | 'published' | 'failed'; propertyId?: string }) {
    const status = q.view === 'scheduled' ? { in: ['SCHEDULED', 'PUBLISHING'] as never[] } : q.view === 'published' ? { in: ['PUBLISHED', 'PARTIAL'] as never[] } : q.view === 'failed' ? { in: ['FAILED'] as never[] } : undefined;
    const where = { companyId: user.companyId, ...(status && { status }), ...(q.propertyId && { propertyId: q.propertyId }) };
    const [rows, total] = await Promise.all([
      this.prisma.socialPost.findMany({ where, include, orderBy: { scheduledAt: q.view === 'scheduled' ? 'asc' : 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.socialPost.count({ where }),
    ]);
    return { items: await this.toDto(user, rows), total, page: q.page, pageSize: q.pageSize };
  }
}
