import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MEDIA_CONTENT_TYPES, MEDIA_MAX_BYTES, MEDIA_MAX_PER_PROPERTY, isProcessableImage,
  type ConfirmMediaInput, type MediaItem, type UpdateMediaInput, type UploadUrlInput,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaQueue } from './media.queue';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
};

type Row = NonNullable<Awaited<ReturnType<PrismaService['propertyMedia']['findFirst']>>>;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: MediaQueue,
    private readonly audit: AuditService,
  ) {}

  serialize(m: Row): MediaItem {
    const processable = isProcessableImage(m.type, m.contentType);
    const url = (k: string | null) => (k ? this.storage.publicUrl(k) : null);
    return {
      id: m.id, propertyId: m.propertyId, type: m.type, filename: m.filename, contentType: m.contentType, sizeBytes: m.sizeBytes,
      width: m.width, height: m.height, caption: m.caption, position: m.position, isCover: m.isCover, aiModified: m.aiModified,
      activeGenerationId: m.activeGenerationId, renderedGenerationId: m.renderedGenerationId,
      status: m.status, processingError: m.processingError,
      originalUrl: this.storage.publicUrl(m.originalKey),
      // Vídeos/PDFs não passam pelo pipeline: a versão publicada é o próprio arquivo.
      processedUrl: url(m.processedKey) ?? (m.status === 'READY' && !processable ? this.storage.publicUrl(m.originalKey) : null),
      thumbnailUrl: url(m.thumbnailKey),
      createdAt: m.createdAt.toISOString(),
    };
  }

  /** Invariante: a capa é sempre a primeira mídia e as posições são contínuas (0..n-1). */
  private async normalize(tx: Pick<PrismaService, 'propertyMedia'>, propertyId: string) {
    const rows = await tx.propertyMedia.findMany({
      where: { propertyId },
      orderBy: [{ isCover: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, position: true },
    });
    for (const [i, r] of rows.entries()) {
      if (r.position !== i) await tx.propertyMedia.update({ where: { id: r.id }, data: { position: i } });
    }
  }

  private async property(companyId: string, id: string) {
    const p = await this.prisma.property.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!p) throw notFound('Imóvel não encontrado.');
  }

  private async load(companyId: string, id: string) {
    const m = await this.prisma.propertyMedia.findFirst({ where: { id, companyId } });
    if (!m) throw notFound('Mídia não encontrada.');
    return m;
  }

  async list(user: AuthedUser, propertyId: string) {
    await this.property(user.companyId, propertyId);
    const rows = await this.prisma.propertyMedia.findMany({ where: { propertyId, companyId: user.companyId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((r) => this.serialize(r));
  }

  // 1) O browser pede uma URL assinada e envia o arquivo direto ao storage.
  async createUploadUrl(user: AuthedUser, propertyId: string, input: UploadUrlInput, origin: string) {
    await this.property(user.companyId, propertyId);
    if (!MEDIA_CONTENT_TYPES[input.type].includes(input.contentType)) throw new AppException('MEDIA_TYPE_INVALID', 400);
    if (input.size > MEDIA_MAX_BYTES[input.type]) throw new AppException('MEDIA_TOO_LARGE', 413);
    if ((await this.prisma.propertyMedia.count({ where: { propertyId } })) >= MEDIA_MAX_PER_PROPERTY) throw new AppException('MEDIA_LIMIT_REACHED', 409);

    const key = this.storage.buildKey(user.companyId, propertyId, 'original', randomUUID(), EXT[input.contentType]!);
    const target = await this.storage.createUpload({ key, contentType: input.contentType, maxBytes: MEDIA_MAX_BYTES[input.type], origin });
    return { key, ...target };
  }

  // 2) Depois do envio, a API confere o arquivo no storage e registra a mídia.
  async confirm(ctx: AuthedCtx, propertyId: string, input: ConfirmMediaInput) {
    const { companyId } = ctx.user;
    await this.property(companyId, propertyId);
    if (!input.key.startsWith(`${companyId}/properties/${propertyId}/original/`) || input.key.includes('..')) {
      throw new AppException('MEDIA_KEY_INVALID', 400);
    }
    if (!MEDIA_CONTENT_TYPES[input.type].includes(input.contentType)) throw new AppException('MEDIA_TYPE_INVALID', 400);
    if (await this.prisma.propertyMedia.findFirst({ where: { originalKey: input.key }, select: { id: true } })) throw new AppException('MEDIA_KEY_INVALID', 400);

    const head = await this.storage.head(input.key);
    if (!head) throw new AppException('MEDIA_NOT_UPLOADED', 400);
    if (head.size > MEDIA_MAX_BYTES[input.type]) {
      await this.storage.delete(input.key);
      throw new AppException('MEDIA_TOO_LARGE', 413);
    }

    const last = await this.prisma.propertyMedia.aggregate({ where: { propertyId }, _max: { position: true } });
    const hasCover = await this.prisma.propertyMedia.count({ where: { propertyId, isCover: true } });
    const processable = isProcessableImage(input.type, input.contentType);
    const media = await this.prisma.propertyMedia.create({
      data: {
        companyId, propertyId, type: input.type, filename: input.filename ?? null, contentType: input.contentType, sizeBytes: head.size,
        originalKey: input.key, caption: input.caption ?? null, position: (last._max.position ?? -1) + 1,
        isCover: input.type === 'IMAGE' && hasCover === 0,
        status: processable ? 'PENDING' : 'READY',
      },
    });
    if (media.isCover) await this.normalize(this.prisma, propertyId);
    await this.audit.record({ companyId, entity: 'PROPERTY', entityId: propertyId, action: 'MEDIA_ADDED', after: { mediaId: media.id, type: media.type, filename: media.filename }, ctx });
    if (processable) await this.queue.enqueue(media.id);
    return this.serialize((await this.prisma.propertyMedia.findUnique({ where: { id: media.id } }))!);
  }

  async reorder(ctx: AuthedCtx, propertyId: string, ids: string[]) {
    const { companyId } = ctx.user;
    await this.property(companyId, propertyId);
    const current = await this.prisma.propertyMedia.findMany({ where: { propertyId, companyId }, select: { id: true } });
    const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((c) => ids.includes(c.id));
    if (!same) throw new AppException('MEDIA_ORDER_INVALID', 400);
    await this.prisma.$transaction(async (tx) => {
      for (const [position, id] of ids.entries()) await tx.propertyMedia.update({ where: { id }, data: { position } });
      await this.normalize(tx, propertyId); // a capa continua na frente
    });
    return this.list(ctx.user, propertyId);
  }

  async update(ctx: AuthedCtx, id: string, input: UpdateMediaInput) {
    const { companyId } = ctx.user;
    const m = await this.load(companyId, id);
    if (input.isCover === true && m.type !== 'IMAGE') throw new AppException('MEDIA_NOT_IMAGE', 400);

    await this.prisma.$transaction(async (tx) => {
      if (input.isCover === true) {
        await tx.propertyMedia.updateMany({ where: { propertyId: m.propertyId, isCover: true }, data: { isCover: false } });
      }
      // Não é possível "desmarcar" a capa: ela só muda ao escolher outra foto.
      await tx.propertyMedia.update({ where: { id }, data: { ...(input.caption !== undefined && { caption: input.caption || null }), ...(input.isCover === true && { isCover: true }) } });
      if (input.isCover === true) await this.normalize(tx, m.propertyId);
    });
    if (input.isCover === true && !m.isCover) {
      await this.audit.record({ companyId, entity: 'PROPERTY', entityId: m.propertyId, action: 'COVER_CHANGED', after: { mediaId: id }, ctx });
    }
    return this.serialize(await this.load(companyId, id));
  }

  async remove(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const m = await this.load(companyId, id);
    const gens = await this.prisma.mediaGeneration.findMany({ where: { mediaId: id }, select: { outputKey: true, thumbKey: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.propertyMedia.delete({ where: { id } });
      if (m.isCover) {
        // A próxima foto (na ordem atual) assume a capa.
        const next = await tx.propertyMedia.findFirst({ where: { propertyId: m.propertyId, type: 'IMAGE' }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
        if (next) await tx.propertyMedia.update({ where: { id: next.id }, data: { isCover: true } });
      }
      await this.normalize(tx, m.propertyId);
    });
    await this.deleteFiles([m], gens);
    await this.audit.record({ companyId, entity: 'PROPERTY', entityId: m.propertyId, action: 'MEDIA_REMOVED', before: { mediaId: id, type: m.type, filename: m.filename }, ctx });
  }

  async reprocess(ctx: AuthedCtx, id: string) {
    const m = await this.load(ctx.user.companyId, id);
    if (m.status !== 'FAILED') throw new AppException('MEDIA_NOT_FAILED', 409);
    await this.prisma.propertyMedia.update({ where: { id }, data: { status: 'PENDING', processingError: null } });
    await this.queue.enqueue(id);
    return this.serialize(await this.load(ctx.user.companyId, id));
  }

  private async deleteFiles(rows: Pick<Row, 'originalKey' | 'processedKey' | 'thumbnailKey' | 'socialKey'>[], gens: { outputKey: string | null; thumbKey: string | null }[] = []) {
    const keys = [...rows.flatMap((r) => [r.originalKey, r.processedKey, r.thumbnailKey, r.socialKey]), ...gens.flatMap((g) => [g.outputKey, g.thumbKey])].filter((k): k is string => !!k);
    await Promise.all(keys.map((k) => this.storage.delete(k)));
  }

  /** Usado ao excluir um imóvel (rascunho): as linhas caem em cascata, os arquivos são removidos aqui. */
  async purgeFiles(companyId: string, propertyId: string) {
    const rows = await this.prisma.propertyMedia.findMany({ where: { companyId, propertyId } });
    const gens = await this.prisma.mediaGeneration.findMany({ where: { companyId, propertyId }, select: { outputKey: true, thumbKey: true } });
    await this.deleteFiles(rows, gens);
  }
}
