import { Inject, Injectable } from '@nestjs/common';
import type { MetaIntegrationInput } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import { decryptJson, encryptJson, secretKeyFor } from '../common/crypto';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MetaApiError } from '../whatsapp/meta.client';
import { MetaConversionsService } from './meta-conversions.service';

interface Secrets { accessToken: string }
interface Config { testEventCode?: string; pixelName?: string }
export interface MetaConfig { pixelId: string; accessToken: string; testEventCode: string | null }

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

  private row(companyId: string) {
    return this.prisma.integration.findUnique({ where: { companyId_provider: { companyId, provider: 'META_CAPI' } } });
  }

  async status(companyId: string) {
    const r = await this.row(companyId);
    const cfg = (r?.config ?? {}) as Config;
    return { connected: !!r?.active, pixelId: r?.externalId ?? null, pixelName: cfg.pixelName ?? null, testEventCode: cfg.testEventCode ?? null, accessTokenSet: !!r };
  }

  async save(ctx: AuthedCtx, input: MetaIntegrationInput) {
    const { companyId } = ctx.user;
    const existing = await this.row(companyId);
    const pixelId = input.pixelId ?? existing?.externalId;
    const accessToken = input.accessToken ?? (existing ? decryptJson<Secrets>(existing.secrets, this.key).accessToken : undefined);
    if (!pixelId || !accessToken) throw new AppException('VALIDATION_FAILED', 400, 'Informe o ID do Pixel e o token de acesso da Conversions API.');
    const config: Config = { ...((existing?.config ?? {}) as Config), ...(input.testEventCode !== undefined && { testEventCode: input.testEventCode || undefined }) };
    if (existing && input.pixelId && input.pixelId !== existing.externalId) config.pixelName = undefined;
    const data = { externalId: pixelId, config: config as object, secrets: encryptJson({ accessToken }, this.key), active: true };
    const saved = existing
      ? await this.prisma.integration.update({ where: { id: existing.id }, data })
      : await this.prisma.integration.create({ data: { ...data, companyId, provider: 'META_CAPI' } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: saved.id, action: existing ? 'UPDATE' : 'CREATE', after: { provider: 'META_CAPI', pixelId, tokenChanged: !!input.accessToken }, ctx });
    return this.status(companyId);
  }

  /** Configuração completa (com token) para uso interno. `null` = Meta não conectada. */
  async config(companyId: string): Promise<MetaConfig | null> {
    const r = await this.row(companyId);
    if (!r?.active || !r.externalId) return null;
    return { pixelId: r.externalId, accessToken: decryptJson<Secrets>(r.secrets, this.key).accessToken, testEventCode: ((r.config ?? {}) as Config).testEventCode ?? null };
  }

  /** ID do Pixel para o site carregar o script (é público por natureza). */
  async publicPixelId(companyId: string) {
    const r = await this.row(companyId);
    return r?.active ? r.externalId : null;
  }

  async test(ctx: AuthedCtx) {
    const cfg = await this.config(ctx.user.companyId);
    if (!cfg) throw new AppException('META_NOT_CONFIGURED', 409);
    try {
      const px = await this.capi.getPixel(cfg);
      const r = await this.row(ctx.user.companyId);
      await this.prisma.integration.update({ where: { id: r!.id }, data: { config: { ...((r!.config ?? {}) as Config), pixelName: px.name } as object } });
      return { ok: true, pixelName: px.name ?? null };
    } catch (e) {
      throw new AppException('META_TEST_FAILED', 400, `A Meta recusou: ${e instanceof MetaApiError ? e.message : 'sem resposta'}`);
    }
  }

  async remove(ctx: AuthedCtx) {
    const r = await this.row(ctx.user.companyId);
    if (!r) throw notFound('Integração não encontrada.');
    await this.prisma.integration.delete({ where: { id: r.id } });
    await this.audit.record({ companyId: ctx.user.companyId, entity: 'INTEGRATION', entityId: r.id, action: 'DELETE', before: { provider: 'META_CAPI', pixelId: r.externalId }, ctx });
  }
}
