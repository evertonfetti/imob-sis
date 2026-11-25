import { Inject, Injectable } from '@nestjs/common';
import type { CreateMetaPixelInput, MetaPixelDto, MetaPixelMonitor, UpdateMetaPixelInput } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import { decryptJson, encryptJson, secretKeyFor } from '../common/crypto';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MetaApiError } from '../whatsapp/meta.client';
import { MetaConversionsService } from './meta-conversions.service';

interface Secrets { accessToken: string }
export interface MetaConfig { id: string; pixelId: string; accessToken: string; testEventCode: string | null }

type PixelRow = { id: string; pixelId: string; name: string | null; active: boolean; testEventCode: string | null };
const dto = (r: PixelRow): MetaPixelDto => ({ id: r.id, pixelId: r.pixelId, name: r.name, active: r.active, testEventCode: r.testEventCode, accessTokenSet: true });
const metaMsg = (e: unknown) => (e instanceof MetaApiError ? e.message : (e as Error)?.message ?? 'sem resposta');

@Injectable()
export class MetaIntegrationService {
  private readonly key: Buffer;
  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capi: MetaConversionsService,
  ) {
    this.key = secretKeyFor(env);
  }

  private async mine(companyId: string, id: string) {
    const r = await this.prisma.metaPixel.findFirst({ where: { id, companyId } });
    if (!r) throw notFound('Pixel não encontrado.');
    return r;
  }

  private cfgOf(r: { id: string; pixelId: string; secrets: string; testEventCode: string | null }): MetaConfig {
    return { id: r.id, pixelId: r.pixelId, accessToken: decryptJson<Secrets>(r.secrets, this.key).accessToken, testEventCode: r.testEventCode };
  }

  async status(companyId: string) {
    const rows = await this.prisma.metaPixel.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    return { connected: rows.some((r) => r.active), pixels: rows.map(dto) };
  }

  async create(ctx: AuthedCtx, input: CreateMetaPixelInput) {
    const { companyId } = ctx.user;
    if (await this.prisma.metaPixel.findUnique({ where: { companyId_pixelId: { companyId, pixelId: input.pixelId } } })) {
      throw new AppException('VALIDATION_FAILED', 409, 'Esse Pixel já está cadastrado. Edite-o na lista.');
    }
    const row = await this.prisma.metaPixel.create({
      data: { companyId, pixelId: input.pixelId, name: input.name || null, testEventCode: input.testEventCode || null, secrets: encryptJson({ accessToken: input.accessToken }, this.key) },
    });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: row.id, action: 'CREATE', after: { provider: 'META_CAPI', pixelId: row.pixelId }, ctx });
    return dto(row);
  }

  async update(ctx: AuthedCtx, id: string, input: UpdateMetaPixelInput) {
    const { companyId } = ctx.user;
    const before = await this.mine(companyId, id);
    const row = await this.prisma.metaPixel.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name || null }),
        ...(input.testEventCode !== undefined && { testEventCode: input.testEventCode || null }),
        ...(input.active !== undefined && { active: input.active }),
        ...(input.accessToken && { secrets: encryptJson({ accessToken: input.accessToken }, this.key) }),
      },
    });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: id, action: 'UPDATE', before: { pixelId: before.pixelId, active: before.active }, after: { pixelId: row.pixelId, active: row.active, tokenChanged: !!input.accessToken }, ctx });
    return dto(row);
  }

  async remove(ctx: AuthedCtx, id: string) {
    const r = await this.mine(ctx.user.companyId, id);
    await this.prisma.metaPixel.delete({ where: { id } });
    await this.audit.record({ companyId: ctx.user.companyId, entity: 'INTEGRATION', entityId: id, action: 'DELETE', before: { provider: 'META_CAPI', pixelId: r.pixelId }, ctx });
  }

  /** Pixels ativos com token, para o envio de conversões. Vazio = Meta não conectada. */
  async configs(companyId: string): Promise<MetaConfig[]> {
    const rows = await this.prisma.metaPixel.findMany({ where: { companyId, active: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.cfgOf(r));
  }

  async config(companyId: string, id: string): Promise<MetaConfig | null> {
    const r = await this.prisma.metaPixel.findFirst({ where: { id, companyId } });
    return r ? this.cfgOf(r) : null;
  }

  /** Configuração de um Pixel pelo ID da Meta (usado pela fila ao reenviar). */
  async configByPixelId(companyId: string, pixelId: string): Promise<MetaConfig | null> {
    const r = await this.prisma.metaPixel.findFirst({ where: { companyId, pixelId, active: true } });
    return r ? this.cfgOf(r) : null;
  }

  /** IDs dos Pixels ativos para o site carregar o script (são públicos por natureza). */
  async publicPixelIds(companyId: string): Promise<string[]> {
    const rows = await this.prisma.metaPixel.findMany({ where: { companyId, active: true }, orderBy: { createdAt: 'asc' }, select: { pixelId: true } });
    return rows.map((r) => r.pixelId);
  }

  async test(ctx: AuthedCtx, id: string) {
    const row = await this.mine(ctx.user.companyId, id);
    try {
      const px = await this.capi.getPixel(this.cfgOf(row));
      if (!row.name && px.name) await this.prisma.metaPixel.update({ where: { id }, data: { name: px.name } });
      return { ok: true, pixelName: px.name ?? null };
    } catch (e) {
      throw new AppException('META_TEST_FAILED', 400, `A Meta recusou: ${metaMsg(e)}`);
    }
  }

  /**
   * Monitoramento: junta o que a Meta informa (último disparo, eventos recebidos, navegador x servidor)
   * com o que o sistema enviou nas últimas 24 h. Se o token não permitir ler estatísticas, o resto continua valendo.
   */
  async monitor(companyId: string): Promise<MetaPixelMonitor[]> {
    const rows = await this.prisma.metaPixel.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    const since = new Date(Date.now() - 24 * 3600_000);
    const sinceUnix = Math.floor(since.getTime() / 1000);
    return Promise.all(rows.map(async (r): Promise<MetaPixelMonitor> => {
      const cfg = this.cfgOf(r);
      const [health, byEvent, bySource, local, lastFail] = await Promise.all([
        this.capi.getPixelHealth(cfg).then((v) => ({ v }), (e) => ({ e: metaMsg(e) })),
        this.capi.getStats(cfg, 'event', sinceUnix).then((v) => ({ v }), (e) => ({ e: metaMsg(e) })),
        this.capi.getStats(cfg, 'event_detection_method', sinceUnix).then((v) => ({ v }), (e) => ({ e: metaMsg(e) })),
        this.prisma.marketingEvent.groupBy({ by: ['status'], where: { companyId, pixelId: r.pixelId, createdAt: { gte: since } }, _count: true }),
        this.prisma.marketingEvent.findFirst({ where: { companyId, pixelId: r.pixelId, status: 'FAILED' }, orderBy: { createdAt: 'desc' }, select: { error: true } }),
      ]);
      const n = (s: string) => local.find((g) => g.status === s)?._count ?? 0;
      const src = 'v' in bySource ? bySource.v : null;
      return {
        id: r.id, pixelId: r.pixelId, name: r.name, active: r.active,
        lastFiredTime: 'v' in health ? health.v.last_fired_time ?? null : null,
        isUnavailable: 'v' in health ? health.v.is_unavailable ?? null : null,
        metaError: 'e' in health ? health.e : null,
        stats: 'v' in byEvent ? [...byEvent.v].map(([event, total]) => ({ event, total })).sort((a, b) => b.total - a.total) : null,
        statsError: 'e' in byEvent ? byEvent.e : null,
        sources: src ? { browser: src.get('browser') ?? 0, server: src.get('server') ?? 0 } : null,
        sent24h: { sent: n('SENT'), failed: n('FAILED'), pending: n('PENDING') },
        lastError: lastFail?.error ?? null,
      };
    }));
  }
}
