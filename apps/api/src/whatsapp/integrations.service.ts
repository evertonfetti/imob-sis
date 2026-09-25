import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { IntegrationInput } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import { decryptJson, deriveKey, encryptJson } from '../common/crypto';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MetaApiError, MetaClient } from './meta.client';

interface Secrets { accessToken: string; appSecret: string }
interface PublicConfig { displayPhone?: string; verifiedName?: string; wabaId?: string; qualityRating?: string }

@Injectable()
export class IntegrationsService {
  private readonly key: Buffer;
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly audit: AuditService) {
    this.key = deriveKey(env.ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET);
  }

  private row(companyId: string) {
    return this.prisma.integration.findUnique({ where: { companyId_provider: { companyId, provider: 'WHATSAPP' } } });
  }

  private client(phoneNumberId: string, accessToken: string) {
    return new MetaClient({ graphUrl: this.env.WHATSAPP_GRAPH_URL, version: this.env.WHATSAPP_API_VERSION, phoneNumberId, accessToken });
  }

  /** Estado para a tela de Integrações. Os segredos nunca são devolvidos. */
  async status(companyId: string, origin: string) {
    const r = await this.row(companyId);
    const cfg = (r?.config ?? {}) as PublicConfig;
    return {
      connected: !!r?.active,
      phoneNumberId: r?.externalId ?? null,
      wabaId: cfg.wabaId ?? null,
      displayPhone: cfg.displayPhone ?? null,
      verifiedName: cfg.verifiedName ?? null,
      qualityRating: cfg.qualityRating ?? null,
      accessTokenSet: !!r,
      appSecretSet: !!r,
      verifyToken: r?.verifyToken ?? null,
      webhookUrl: `${(this.env.API_PUBLIC_URL ?? origin).replace(/\/$/, '')}/webhooks/meta/whatsapp`,
    };
  }

  async save(ctx: AuthedCtx, input: IntegrationInput) {
    const { companyId } = ctx.user;
    const existing = await this.row(companyId);
    const secrets: Partial<Secrets> = existing ? decryptJson<Secrets>(existing.secrets, this.key) : {};
    const phoneNumberId = input.phoneNumberId ?? existing?.externalId;
    const accessToken = input.accessToken ?? secrets.accessToken;
    const appSecret = input.appSecret ?? secrets.appSecret;
    if (!phoneNumberId || !accessToken || !appSecret) {
      throw new AppException('VALIDATION_FAILED', 400, 'Informe o ID do número, o token de acesso e o segredo do app.');
    }
    const taken = await this.prisma.integration.findFirst({ where: { provider: 'WHATSAPP', externalId: phoneNumberId, NOT: { companyId } }, select: { id: true } });
    if (taken) throw new AppException('WHATSAPP_PHONE_IN_USE', 409);

    const config: PublicConfig = { ...((existing?.config ?? {}) as PublicConfig), ...(input.wabaId !== undefined && { wabaId: input.wabaId || undefined }) };
    if (existing && input.phoneNumberId && input.phoneNumberId !== existing.externalId) { config.displayPhone = undefined; config.verifiedName = undefined; }
    const data = { externalId: phoneNumberId, config: config as object, secrets: encryptJson({ accessToken, appSecret }, this.key), active: true };
    const saved = existing
      ? await this.prisma.integration.update({ where: { id: existing.id }, data })
      : await this.prisma.integration.create({ data: { ...data, companyId, provider: 'WHATSAPP', verifyToken: randomBytes(24).toString('hex') } });
    await this.audit.record({
      companyId, entity: 'INTEGRATION', entityId: saved.id, action: existing ? 'UPDATE' : 'CREATE',
      after: { provider: 'WHATSAPP', phoneNumberId, tokenChanged: !!input.accessToken, secretChanged: !!input.appSecret }, ctx,
    });
    return saved;
  }

  /** Valida as credenciais chamando a Meta e guarda o número/nome verificado. */
  async test(ctx: AuthedCtx) {
    const r = await this.row(ctx.user.companyId);
    if (!r?.externalId) throw new AppException('WHATSAPP_NOT_CONFIGURED', 409);
    const { accessToken } = decryptJson<Secrets>(r.secrets, this.key);
    try {
      const info = await this.client(r.externalId, accessToken).getPhone();
      const config = { ...((r.config ?? {}) as PublicConfig), displayPhone: info.display_phone_number, verifiedName: info.verified_name, qualityRating: info.quality_rating };
      await this.prisma.integration.update({ where: { id: r.id }, data: { config: config as object } });
      return { ok: true, displayPhone: info.display_phone_number ?? null, verifiedName: info.verified_name ?? null, qualityRating: info.quality_rating ?? null };
    } catch (e) {
      throw new AppException('WHATSAPP_TEST_FAILED', 400, `Não foi possível validar com a Meta: ${e instanceof MetaApiError ? e.message : 'sem resposta'}`);
    }
  }

  async remove(ctx: AuthedCtx) {
    const r = await this.row(ctx.user.companyId);
    if (!r) throw notFound('Integração não encontrada.');
    await this.prisma.integration.delete({ where: { id: r.id } });
    await this.audit.record({ companyId: ctx.user.companyId, entity: 'INTEGRATION', entityId: r.id, action: 'DELETE', before: { provider: 'WHATSAPP', phoneNumberId: r.externalId }, ctx });
  }

  // ---------- Uso interno ----------
  /** Cliente da Meta da empresa; falha se o WhatsApp não estiver conectado. */
  async clientFor(companyId: string): Promise<MetaClient> {
    const r = await this.row(companyId);
    if (!r?.active || !r.externalId) throw new AppException('WHATSAPP_NOT_CONFIGURED', 409);
    return this.client(r.externalId, decryptJson<Secrets>(r.secrets, this.key).accessToken);
  }

  async isConnected(companyId: string) {
    return !!(await this.row(companyId))?.active;
  }

  /** Webhook: descobre a empresa pelo número que recebeu a mensagem. */
  async byPhoneNumberId(phoneNumberId: string) {
    const r = await this.prisma.integration.findFirst({ where: { provider: 'WHATSAPP', externalId: phoneNumberId, active: true } });
    return r ? { companyId: r.companyId, appSecret: decryptJson<Secrets>(r.secrets, this.key).appSecret } : null;
  }

  async verifyTokenExists(token: string) {
    return !!(await this.prisma.integration.findFirst({ where: { provider: 'WHATSAPP', verifyToken: token }, select: { id: true } }));
  }
}
