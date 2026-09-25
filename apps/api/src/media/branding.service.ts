import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolveWatermark, type LogoUploadInput, type UpdateWatermarkInput, type WatermarkDto } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaQueue } from './media.queue';
import { normalizeLogo } from './watermark';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/** Logo da empresa e marca d'água nas fotos publicadas. O original de cada foto nunca recebe a marca. */
@Injectable()
export class BrandingService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly queue: MediaQueue, private readonly audit: AuditService,
  ) {}

  private outdatedWhere(companyId: string, enabled: boolean, revision: number) {
    const target = enabled ? revision : null;
    return { companyId, type: 'IMAGE' as const, status: 'READY' as const, ...(target === null ? { watermarkRevision: { not: null } } : { OR: [{ watermarkRevision: null }, { watermarkRevision: { not: target } }] }) };
  }

  async get(companyId: string): Promise<WatermarkDto> {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { watermarkSettings: true, watermarkRevision: true, logoKey: true, logoUrl: true } });
    const settings = resolveWatermark(c.watermarkSettings);
    const effective = settings.enabled && !!c.logoKey;
    const [outdated, total] = await Promise.all([
      this.prisma.propertyMedia.count({ where: this.outdatedWhere(companyId, effective, c.watermarkRevision) }),
      this.prisma.propertyMedia.count({ where: { companyId, type: 'IMAGE', status: 'READY' } }),
    ]);
    return { settings, logoUrl: c.logoKey ? c.logoUrl : null, hasLogo: !!c.logoKey, outdatedPhotos: outdated, totalPhotos: total };
  }

  // ---------- Logo ----------
  createLogoUpload(companyId: string, input: LogoUploadInput, origin: string) {
    const key = `${companyId}/branding/upload/${randomUUID()}.${EXT[input.contentType]}`;
    return this.storage.createUpload({ key, contentType: input.contentType, maxBytes: input.sizeBytes, origin }).then((target) => ({ key, ...target }));
  }

  async confirmLogo(ctx: AuthedCtx, key: string) {
    const { companyId } = ctx.user;
    if (!key.startsWith(`${companyId}/branding/upload/`)) throw new AppException('LOGO_INVALID', 400); // chave de outra empresa ou fora do fluxo
    if (!(await this.storage.head(key))) throw new AppException('LOGO_INVALID', 400);
    let png: Buffer;
    try { png = (await normalizeLogo(await this.storage.read(key))).png; } catch { await this.storage.delete(key).catch(() => undefined); throw new AppException('LOGO_INVALID', 400); }
    const cur = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { logoKey: true } });
    const newKey = `${companyId}/branding/logo-${Date.now().toString(36)}.png`;
    await this.storage.write(newKey, png, 'image/png');
    await this.prisma.company.update({ where: { id: companyId }, data: { logoKey: newKey, logoUrl: this.storage.publicUrl(newKey), watermarkRevision: { increment: 1 } } });
    await this.storage.delete(key).catch(() => undefined);
    if (cur.logoKey) await this.storage.delete(cur.logoKey).catch(() => undefined);
    await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'LOGO_UPLOAD', ctx });
    return this.get(companyId);
  }

  async removeLogo(ctx: AuthedCtx) {
    const { companyId } = ctx.user;
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { logoKey: true, watermarkSettings: true } });
    if (!c.logoKey) return this.get(companyId);
    const settings = { ...resolveWatermark(c.watermarkSettings), enabled: false }; // sem logo não há marca d'água
    await this.prisma.company.update({ where: { id: companyId }, data: { logoKey: null, logoUrl: null, watermarkSettings: settings, watermarkRevision: { increment: 1 } } });
    await this.storage.delete(c.logoKey).catch(() => undefined);
    await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'LOGO_REMOVE', ctx });
    return this.get(companyId);
  }

  // ---------- Marca d'água ----------
  async update(ctx: AuthedCtx, input: UpdateWatermarkInput) {
    const { companyId } = ctx.user;
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { watermarkSettings: true, logoKey: true } });
    const before = resolveWatermark(c.watermarkSettings);
    const next = { ...before, ...input };
    if (next.enabled && !c.logoKey) throw new AppException('LOGO_REQUIRED', 400);
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      await this.prisma.company.update({ where: { id: companyId }, data: { watermarkSettings: next, watermarkRevision: { increment: 1 } } });
      await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'UPDATE', before: { watermark: before }, after: { watermark: next }, ctx });
    }
    return this.get(companyId);
  }

  /** Reaplica (ou remove) a marca nas fotos que ainda estão com a versão anterior. Novas fotos já saem certas. */
  async applyToExisting(ctx: AuthedCtx) {
    const { companyId } = ctx.user;
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { watermarkSettings: true, watermarkRevision: true, logoKey: true } });
    const effective = resolveWatermark(c.watermarkSettings).enabled && !!c.logoKey;
    const rows = await this.prisma.propertyMedia.findMany({ where: this.outdatedWhere(companyId, effective, c.watermarkRevision), select: { id: true } });
    const work = (async () => { for (const r of rows) await this.queue.enqueue(r.id, { force: true }); })();
    if (this.env.NODE_ENV === 'test') await work; else void work.catch(() => undefined);
    await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'WATERMARK_APPLY', after: { photos: rows.length }, ctx });
    return { queued: rows.length };
  }
}
