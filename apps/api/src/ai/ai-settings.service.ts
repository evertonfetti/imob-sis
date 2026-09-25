import { Inject, Injectable } from '@nestjs/common';
import {
  AI_DEFAULT_MONTHLY_LIMIT, AI_PROVIDERS, AI_PROVIDER_INFO, type AiProviderId, type AiSettingsDto, type AiSettingsInput,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { decryptJson, encryptJson, secretKeyFor } from '../common/crypto';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiProvider, type HttpConfig } from './providers/gemini.provider';
import { LocalProvider } from './providers/local.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { AiProviderError, type AIImageProvider } from './providers/provider';

interface Config { provider: AiProviderId; models?: Partial<Record<AiProviderId, string>>; monthlyLimit?: number }
interface Secrets { keys?: Partial<Record<AiProviderId, string>> }

/** Início do mês em São Paulo (UTC-3), em UTC. */
export function monthStart(now = new Date()) {
  const sp = new Date(now.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), 1) + 3 * 3_600_000);
}

/** Provedor de IA da empresa: escolha, modelo, chaves (uma por provedor, criptografadas) e limite mensal. */
@Injectable()
export class AiSettingsService {
  private readonly key: Buffer;
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly audit: AuditService) { this.key = secretKeyFor(env); }

  private row(companyId: string) { return this.prisma.integration.findUnique({ where: { companyId_provider: { companyId, provider: 'AI_IMAGE' } } }); }

  private read(r: Awaited<ReturnType<AiSettingsService['row']>>): { config: Config; keys: NonNullable<Secrets['keys']> } {
    const config = (r?.config ?? {}) as unknown as Config;
    return { config: { ...config, provider: AI_PROVIDERS.includes(config.provider) ? config.provider : 'local' }, keys: r ? (decryptJson<Secrets>(r.secrets, this.key).keys ?? {}) : {} };
  }

  private build(id: AiProviderId, model: string | null, apiKey: string): AIImageProvider {
    if (id === 'local') return new LocalProvider();
    const info = AI_PROVIDER_INFO[id];
    const cfg: HttpConfig = { baseUrl: (id === 'gemini' ? this.env.GEMINI_API_URL : this.env.OPENAI_API_URL).replace(/\/$/, ''), apiKey, model: model || info.defaultModel!, timeoutMs: this.env.AI_TIMEOUT_MS, costUsd: info.estimatedCostUsd };
    return id === 'gemini' ? new GeminiProvider(cfg) : new OpenAiProvider(cfg);
  }

  /** Provedor configurado (ou o básico local, que não precisa de nada). */
  async resolve(companyId: string): Promise<{ id: AiProviderId; model: string | null; provider: AIImageProvider }> {
    const { config, keys } = this.read(await this.row(companyId));
    const id = config.provider;
    if (id === 'local') return { id, model: null, provider: new LocalProvider() };
    const apiKey = keys[id];
    if (!apiKey) throw new AppException('AI_KEY_INVALID', 400, 'A chave do provedor de IA não está configurada. Ajuste em Empresa → Imagens e IA.');
    const model = config.models?.[id] || AI_PROVIDER_INFO[id].defaultModel;
    return { id, model, provider: this.build(id, model, apiKey) };
  }

  /** Provedor pelo id gravado na geração (a configuração pode ter mudado depois do pedido). */
  async resolveById(companyId: string, id: AiProviderId) {
    const { config, keys } = this.read(await this.row(companyId));
    if (id === 'local') return new LocalProvider();
    if (!keys[id]) throw new AiProviderError('A chave do provedor de IA foi removida. Configure novamente em Empresa → Imagens e IA.', 400, 'auth');
    return this.build(id, config.models?.[id] ?? null, keys[id]!);
  }

  async monthlyLimit(companyId: string) { return this.read(await this.row(companyId)).config.monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT; }

  /** Uso do mês: só conta edições que custam (provedor pago) e não falharam. */
  async usage(companyId: string) {
    const from = monthStart();
    const rows = await this.prisma.mediaGeneration.aggregate({ where: { companyId, createdAt: { gte: from }, provider: { not: 'local' }, status: { not: 'FAILED' } }, _count: true, _sum: { cost: true } });
    return { month: new Date(from.getTime() - 3 * 3_600_000).toISOString().slice(0, 7), generations: rows._count, cost: Number(rows._sum.cost ?? 0) };
  }

  async dto(companyId: string): Promise<AiSettingsDto> {
    const { config, keys } = this.read(await this.row(companyId));
    return {
      provider: config.provider, model: config.provider === 'local' ? null : (config.models?.[config.provider] ?? AI_PROVIDER_INFO[config.provider].defaultModel),
      keySet: config.provider === 'local' ? true : !!keys[config.provider], monthlyLimit: config.monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT,
      usage: await this.usage(companyId),
      providers: AI_PROVIDERS.map((id) => ({ id, label: AI_PROVIDER_INFO[id].label, needsKey: AI_PROVIDER_INFO[id].needsKey, defaultModel: AI_PROVIDER_INFO[id].defaultModel, note: AI_PROVIDER_INFO[id].note })),
    };
  }

  async save(ctx: AuthedCtx, input: AiSettingsInput) {
    const { companyId } = ctx.user;
    const existing = await this.row(companyId);
    const { config, keys } = this.read(existing);
    const id = input.provider;
    if (id !== 'local') {
      const apiKey = input.apiKey ?? keys[id];
      if (!apiKey) throw new AppException('VALIDATION_FAILED', 400, 'Informe a chave de acesso do provedor.');
      if (input.apiKey) {
        try { await this.build(id, input.model ?? config.models?.[id] ?? null, apiKey).check?.(); }
        catch (e) { throw new AppException('AI_KEY_INVALID', e instanceof AiProviderError && e.kind !== 'auth' ? 502 : 400, e instanceof AiProviderError && e.kind !== 'auth' ? e.message : undefined); }
        keys[id] = apiKey;
      }
    }
    const next: Config = {
      provider: id, models: { ...(config.models ?? {}), ...(id !== 'local' && input.model !== undefined && { [id]: input.model || undefined }) },
      monthlyLimit: input.monthlyLimit ?? config.monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT,
    };
    const data = { externalId: id, config: next as object, secrets: encryptJson({ keys } satisfies Secrets, this.key), active: true };
    const saved = existing ? await this.prisma.integration.update({ where: { id: existing.id }, data }) : await this.prisma.integration.create({ data: { ...data, companyId, provider: 'AI_IMAGE' } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: saved.id, action: existing ? 'UPDATE' : 'CREATE', after: { provider: 'AI_IMAGE', aiProvider: id, model: next.models?.[id] ?? null, monthlyLimit: next.monthlyLimit, keyChanged: !!input.apiKey }, ctx });
    return this.dto(companyId);
  }
}
