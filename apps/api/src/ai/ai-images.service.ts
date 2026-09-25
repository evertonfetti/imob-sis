import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import sharp from 'sharp';
import {
  AI_GENERATIVE_ONLY, type AiOperation, type AiProviderId, type CreateGenerationInput, type MediaGenerationDto, type MediaVersionsDto,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { MediaQueue } from '../media/media.queue';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AiSettingsService } from './ai-settings.service';
import { AiProviderError, run } from './providers/provider';

const QUEUE = 'ai-generation';
const STALE_MS = 10 * 60_000; // uma geração "em andamento" há mais que isso é considerada perdida
const INPUT_MAX = 2048;

type Gen = NonNullable<Awaited<ReturnType<PrismaService['mediaGeneration']['findFirst']>>>;

/**
 * Edições de foto por IA (spec §22–23). Cada pedido vira uma versão nova; a foto original nunca é substituída
 * e o usuário escolhe qual versão publicar (aprovação). Sem retentativa automática: cada tentativa pode custar.
 */
@Injectable()
export class AiImagesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AiImages');
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly settings: AiSettingsService,
    private readonly mediaQueue: MediaQueue, private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (!this.env.REDIS_URL) return;
    const prefix = this.env.NODE_ENV === 'test' ? 'bull-test' : 'bull';
    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.worker = new Worker(QUEUE, (job) => this.run(job.data.id), { connection: this.connection, prefix, concurrency: 2 });
    this.worker.on('error', (e) => this.log.error(e.message));
  }
  async onModuleDestroy() { await this.worker?.close(); await this.queue?.close(); this.connection?.disconnect(); }

  private async dispatch(id: string) {
    if (this.queue) {
      try {
        await Promise.race([this.queue.add('generate', { id }, { attempts: 1, removeOnComplete: 200, removeOnFail: 500 }), new Promise((_, r) => setTimeout(() => r(new Error('Redis não respondeu')), 3000))]);
        return;
      } catch (e) { this.log.warn(`Fila de IA indisponível (${(e as Error).message}); processando em linha.`); }
    }
    const work = this.run(id);
    if (this.env.NODE_ENV === 'test') await work; else void work; // em produção a requisição não espera o provedor
  }

  // ---------- DTOs ----------
  private dto(g: Gen, activeId: string | null): MediaGenerationDto {
    const url = (k: string | null) => (k ? this.storage.publicUrl(k) : null);
    return {
      id: g.id, mediaId: g.mediaId, parentId: g.parentId, operation: g.operation, status: g.status, provider: g.provider, model: g.model, prompt: g.prompt,
      style: ((g.options ?? {}) as { style?: string }).style ?? null, outputUrl: url(g.outputKey), thumbUrl: url(g.thumbKey), cost: g.cost == null ? null : Number(g.cost),
      error: g.error, durationMs: g.durationMs, active: g.id === activeId, approvedAt: g.approvedAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString(),
    };
  }

  private async loadMedia(companyId: string, mediaId: string) {
    const m = await this.prisma.propertyMedia.findFirst({ where: { id: mediaId, companyId } });
    if (!m) throw notFound('Mídia não encontrada.');
    return m;
  }

  async versions(user: AuthedUser, mediaId: string): Promise<MediaVersionsDto> {
    const m = await this.loadMedia(user.companyId, mediaId);
    const gens = await this.prisma.mediaGeneration.findMany({ where: { mediaId }, orderBy: { createdAt: 'asc' } });
    return { mediaId, originalUrl: this.storage.publicUrl(m.originalKey), activeGenerationId: m.activeGenerationId, generations: gens.map((g) => this.dto(g, m.activeGenerationId)) };
  }

  // ---------- Pedido ----------
  async create(ctx: AuthedCtx, mediaId: string, input: CreateGenerationInput): Promise<MediaVersionsDto> {
    const { companyId } = ctx.user;
    const m = await this.loadMedia(companyId, mediaId);
    if (m.type !== 'IMAGE' || m.status !== 'READY') throw new AppException('AI_MEDIA_INVALID', 409);
    const op = input.operation as AiOperation;
    if (op === 'REMOVE_OBJECT' && !input.prompt?.trim()) throw new AppException('AI_PROMPT_REQUIRED', 400);

    let inputKey = m.originalKey;
    if (input.parentId) {
      const parent = await this.prisma.mediaGeneration.findFirst({ where: { id: input.parentId, mediaId, status: 'READY' } });
      if (!parent?.outputKey) throw new AppException('AI_GENERATION_NOT_READY', 409);
      inputKey = parent.outputKey;
    }

    const { id: providerId, model, provider } = await this.settings.resolve(companyId);
    if (!provider.supports(op)) throw new AppException('AI_OPERATION_UNSUPPORTED', 400);

    // Uma edição por foto de cada vez (evita gastar duas vezes no mesmo clique).
    const busy = await this.prisma.mediaGeneration.findFirst({ where: { mediaId, status: { in: ['QUEUED', 'PROCESSING'] }, createdAt: { gte: new Date(Date.now() - STALE_MS) } } });
    if (busy) throw new AppException('AI_GENERATION_BUSY', 409);
    await this.prisma.mediaGeneration.updateMany({ where: { mediaId, status: { in: ['QUEUED', 'PROCESSING'] }, createdAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'FAILED', error: 'A edição não terminou e foi cancelada.' } });

    if (providerId !== 'local') {
      const [usage, limit] = await Promise.all([this.settings.usage(companyId), this.settings.monthlyLimit(companyId)]);
      if (usage.generations >= limit) throw new AppException('AI_LIMIT_REACHED', 429);
    }

    const gen = await this.prisma.mediaGeneration.create({
      data: {
        companyId, propertyId: m.propertyId, mediaId, userId: ctx.user.id, parentId: input.parentId ?? null, operation: op, provider: providerId, model,
        prompt: input.prompt?.trim() || null, options: input.style ? { style: input.style } : undefined, inputKey,
      },
    });
    await this.audit.record({ companyId, entity: 'PROPERTY', entityId: m.propertyId, action: 'AI_GENERATE', after: { mediaId, operation: op, provider: providerId, generationId: gen.id }, ctx });
    await this.dispatch(gen.id);
    return this.versions(ctx.user, mediaId);
  }

  /** Executa a edição (fila ou em linha). Idempotente: só roda uma geração ainda QUEUED. */
  async run(id: string): Promise<void> {
    const claimed = await this.prisma.mediaGeneration.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'PROCESSING' } });
    if (!claimed.count) return;
    const g = await this.prisma.mediaGeneration.findUniqueOrThrow({ where: { id } });
    const started = Date.now();
    try {
      const provider = await this.settings.resolveById(g.companyId, g.provider as AiProviderId);
      const src = await this.storage.read(g.inputKey);
      const prepared = await sharp(src).rotate().resize({ width: INPUT_MAX, height: INPUT_MAX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
      const style = ((g.options ?? {}) as { style?: string }).style ?? null;
      const result = await run(provider, g.operation as AiOperation, { image: prepared.data, mimeType: 'image/jpeg', width: prepared.info.width, height: prepared.info.height, prompt: g.prompt, style });

      // Mantém a proporção da foto de entrada (alguns provedores só devolvem tamanhos fixos): corta o excesso no centro.
      const outMeta = await sharp(result.image).metadata();
      const inRatio = prepared.info.width / prepared.info.height;
      let img = sharp(result.image).rotate();
      if (outMeta.width && outMeta.height && Math.abs(outMeta.width / outMeta.height - inRatio) / inRatio > 0.03) {
        const w = outMeta.width / outMeta.height > inRatio ? Math.round(outMeta.height * inRatio) : outMeta.width;
        const h = outMeta.width / outMeta.height > inRatio ? outMeta.height : Math.round(outMeta.width / inRatio);
        img = img.extract({ left: Math.floor((outMeta.width - w) / 2), top: Math.floor((outMeta.height - h) / 2), width: w, height: h });
      }
      const out = await img.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const thumb = await sharp(out).resize({ width: 480, height: 360, fit: 'cover' }).webp({ quality: 74 }).toBuffer();
      const base = `${g.companyId}/properties/${g.propertyId}`; // mesma raiz das demais mídias do imóvel (a entrada pode ser o original ou outra versão)
      const outputKey = `${base}/ai/${g.id}.jpg`;
      const thumbKey = `${base}/ai/${g.id}.thumb.webp`;
      await this.storage.write(outputKey, out, 'image/jpeg');
      await this.storage.write(thumbKey, thumb, 'image/webp');
      await this.prisma.mediaGeneration.update({ where: { id }, data: { status: 'READY', outputKey, thumbKey, model: result.model ?? g.model, cost: result.costUsd, durationMs: Date.now() - started, error: null } });
    } catch (e) {
      const message = e instanceof AiProviderError ? e.message : 'Não foi possível concluir a edição. Tente novamente.';
      if (!(e instanceof AiProviderError)) this.log.error(`Geração ${id}: ${(e as Error).message}`);
      await this.prisma.mediaGeneration.update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 300), cost: 0, durationMs: Date.now() - started } });
    }
  }

  // ---------- Aprovação ----------
  async approve(ctx: AuthedCtx, generationId: string): Promise<MediaVersionsDto> {
    const g = await this.prisma.mediaGeneration.findFirst({ where: { id: generationId, companyId: ctx.user.companyId } });
    if (!g) throw notFound('Versão não encontrada.');
    if (g.status !== 'READY' || !g.outputKey) throw new AppException('AI_GENERATION_NOT_READY', 409);
    await this.prisma.$transaction([
      this.prisma.mediaGeneration.update({ where: { id: g.id }, data: { approvedAt: new Date() } }),
      this.prisma.propertyMedia.update({ where: { id: g.mediaId }, data: { activeGenerationId: g.id, aiModified: true } }),
    ]);
    await this.audit.record({ companyId: g.companyId, entity: 'PROPERTY', entityId: g.propertyId, action: 'AI_APPROVE', after: { mediaId: g.mediaId, generationId: g.id, operation: g.operation }, ctx });
    await this.mediaQueue.enqueue(g.mediaId, { force: true }); // renderiza a versão publicada (WebP, marca d'água…)
    return this.versions(ctx.user, g.mediaId);
  }

  /** Volta a publicar a foto original. As versões de IA continuam no histórico. */
  async revert(ctx: AuthedCtx, mediaId: string): Promise<MediaVersionsDto> {
    const m = await this.loadMedia(ctx.user.companyId, mediaId);
    if (m.activeGenerationId) {
      await this.prisma.propertyMedia.update({ where: { id: mediaId }, data: { activeGenerationId: null, aiModified: false } });
      await this.audit.record({ companyId: m.companyId, entity: 'PROPERTY', entityId: m.propertyId, action: 'AI_REVERT', after: { mediaId }, ctx });
      await this.mediaQueue.enqueue(mediaId, { force: true });
    }
    return this.versions(ctx.user, mediaId);
  }

  /** Descarta uma versão que não foi publicada nem serviu de base para outra. */
  async discard(ctx: AuthedCtx, generationId: string): Promise<MediaVersionsDto> {
    const g = await this.prisma.mediaGeneration.findFirst({ where: { id: generationId, companyId: ctx.user.companyId } });
    if (!g) throw notFound('Versão não encontrada.');
    const [m, children] = await Promise.all([this.loadMedia(g.companyId, g.mediaId), this.prisma.mediaGeneration.count({ where: { parentId: g.id } })]);
    if (m.activeGenerationId === g.id || children > 0) throw new AppException('AI_GENERATION_IN_USE', 409);
    if (g.status === 'PROCESSING' || g.status === 'QUEUED') throw new AppException('AI_GENERATION_BUSY', 409);
    await this.prisma.mediaGeneration.delete({ where: { id: g.id } });
    for (const k of [g.outputKey, g.thumbKey]) if (k) await this.storage.delete(k).catch(() => undefined);
    return this.versions(ctx.user, g.mediaId);
  }

  get onlyGenerative() { return AI_GENERATIVE_ONLY; }
}
