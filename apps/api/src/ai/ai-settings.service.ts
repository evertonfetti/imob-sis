import { Inject, Injectable } from '@nestjs/common';
import {
  AI_DEFAULT_MONTHLY_LIMIT, AI_LOCAL_MODEL_ID, AI_LOCAL_OPERATIONS, AI_PROVIDERS, AI_PROVIDER_CATALOG, AI_TEXT_ONLY_PROVIDERS,
  type AiAccountDto, type AiAccountInput, type AiChoiceDto, type AiModelDto, type AiModelInput, type AiOperation, type AiProviderId,
  type AiSettingsDto, type AiSettingsInput, type AiStatusDto, type DiscoveredModelDto, type UpdateAiAccountInput, type UpdateAiModelInput,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import { decryptJson, encryptJson, secretKeyFor } from '../common/crypto';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiProvider, type HttpConfig } from './providers/gemini.provider';
import { LocalProvider } from './providers/local.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { discoverModels } from './providers/discovery';
import { AiProviderError, type AIImageProvider } from './providers/provider';
import { AnthropicText, GeminiText, OpenAiText, type AITextProvider } from './text/text-provider';

interface Stored { monthlyLimit?: number; defaultModelId?: string | null; operationDefaults?: Partial<Record<AiOperation, string | null>> }
export interface ResolvedModel {
  id: string; providerId: 'local' | AiProviderId; model: string | null; accountId: string | null; accountName: string | null; label: string; costUsd: number; provider: AIImageProvider;
}

/** Início do mês em São Paulo (UTC-3), em UTC. */
export function monthStart(now = new Date()) {
  const sp = new Date(now.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), 1) + 3 * 3_600_000);
}

const num = (v: unknown) => Number(v ?? 0);
const isProvider = (p: string): p is AiProviderId => (AI_PROVIDERS as readonly string[]).includes(p);

/**
 * Contas de IA da empresa (várias chaves, inclusive do mesmo provedor), os modelos de cada conta em níveis
 * econômico/padrão/premium, e os padrões de uso (geral e por tipo de edição). As chaves ficam criptografadas.
 */
@Injectable()
export class AiSettingsService {
  private readonly key: Buffer;
  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly audit: AuditService) { this.key = secretKeyFor(env); }

  // ---------- Construção dos provedores ----------
  private build(provider: AiProviderId, model: string, apiKey: string, costUsd: number): AIImageProvider {
    if (AI_TEXT_ONLY_PROVIDERS.includes(provider)) throw new AppException('AI_KIND_UNSUPPORTED', 400);
    const cfg: HttpConfig = { baseUrl: this.baseUrl(provider), apiKey, model, timeoutMs: this.env.AI_TIMEOUT_MS, costUsd };
    return provider === 'gemini' ? new GeminiProvider(cfg) : new OpenAiProvider(cfg);
  }
  private apiKey(secrets: string) { return decryptJson<{ apiKey: string }>(secrets, this.key).apiKey; }

  private async stored(companyId: string): Promise<Stored> {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { aiSettings: true } });
    return ((c?.aiSettings ?? {}) as unknown as Stored) ?? {};
  }
  async monthlyLimit(companyId: string) { return (await this.stored(companyId)).monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT; }

  private local(): ResolvedModel { return { id: AI_LOCAL_MODEL_ID, providerId: 'local', model: null, accountId: null, accountName: null, label: 'Básico (servidor, sem custo)', costUsd: 0, provider: new LocalProvider() }; }

  // ---------- Escolha do modelo ----------
  /** Modelo ativo (de conta ativa) pelo id do cadastro, ou o embutido. `null` = indisponível. */
  async choice(companyId: string, id: string): Promise<ResolvedModel | null> {
    if (id === AI_LOCAL_MODEL_ID) return this.local();
    const m = await this.prisma.aiModel.findFirst({ where: { id, companyId, kind: 'IMAGE', enabled: true, account: { active: true } }, include: { account: true } });
    if (!m || !isProvider(m.account.provider)) return null;
    return { id: m.id, providerId: m.account.provider, model: m.model, accountId: m.accountId, accountName: m.account.name, label: m.label, costUsd: num(m.costUsd), provider: this.build(m.account.provider, m.model, this.apiKey(m.account.secrets), num(m.costUsd)) };
  }

  /** Modelo a usar: o pedido; senão o padrão do tipo de edição; senão o padrão da empresa; senão o primeiro "padrão" cadastrado; senão o embutido. */
  async resolve(companyId: string, op: AiOperation, explicitId?: string | null): Promise<ResolvedModel> {
    if (explicitId) {
      const c = await this.choice(companyId, explicitId);
      if (!c) throw new AppException('AI_MODEL_INVALID', 400);
      return c;
    }
    const st = await this.stored(companyId);
    for (const id of [st.operationDefaults?.[op], st.defaultModelId]) {
      if (!id) continue;
      const c = await this.choice(companyId, id);
      if (c && (c.providerId !== 'local' || AI_LOCAL_OPERATIONS.includes(op))) return c;
    }
    // Sem padrão definido: o primeiro modelo de nível "padrão" (senão qualquer um ativo); sem nada cadastrado, o embutido.
    const active = { companyId, kind: 'IMAGE' as const, enabled: true, account: { active: true } };
    const pick = (await this.prisma.aiModel.findFirst({ where: { ...active, tier: 'STANDARD' }, orderBy: { createdAt: 'asc' }, select: { id: true } }))
      ?? (await this.prisma.aiModel.findFirst({ where: active, orderBy: { createdAt: 'asc' }, select: { id: true } }));
    return (pick ? await this.choice(companyId, pick.id) : null) ?? this.local();
  }

  /** Provedor para executar uma geração já registrada (a configuração pode ter mudado depois do pedido). */
  async forGeneration(g: { provider: string; accountId: string | null; model: string | null; options: unknown }): Promise<AIImageProvider> {
    if (g.provider === 'local') return new LocalProvider();
    const account = g.accountId ? await this.prisma.aiAccount.findUnique({ where: { id: g.accountId } }) : null;
    if (!account || !isProvider(g.provider) || !g.model) throw new AiProviderError('A conta de IA usada neste pedido foi removida. Escolha outro modelo.', 400, 'auth');
    const cost = num(((g.options ?? {}) as { costUsd?: number }).costUsd);
    return this.build(g.provider, g.model, this.apiKey(account.secrets), cost);
  }

  /** Opções do estúdio de edição: só o que está ativo. */
  async status(companyId: string): Promise<AiStatusDto> {
    const [models, st, usage] = await Promise.all([
      this.prisma.aiModel.findMany({ where: { companyId, kind: 'IMAGE', enabled: true, account: { active: true } }, include: { account: true }, orderBy: [{ createdAt: 'asc' }] }),
      this.stored(companyId), this.usage(companyId),
    ]);
    const order = { ECONOMIC: 0, STANDARD: 1, PREMIUM: 2 } as const;
    const choices: AiChoiceDto[] = [
      { id: AI_LOCAL_MODEL_ID, label: 'Básico (servidor, sem custo)', provider: 'local', accountName: null, tier: null, costUsd: 0, operations: AI_LOCAL_OPERATIONS },
      ...models.sort((a, b) => order[a.tier] - order[b.tier]).map((m): AiChoiceDto => ({ id: m.id, label: m.label, provider: m.account.provider, accountName: m.account.name, tier: m.tier, costUsd: num(m.costUsd), operations: [...ALL_OPS] })),
    ];
    const valid = new Set(choices.map((c) => c.id));
    const ops = Object.fromEntries(Object.entries(st.operationDefaults ?? {}).filter(([, v]) => v && valid.has(v))) as AiStatusDto['operationDefaults'];
    const def = st.defaultModelId && valid.has(st.defaultModelId) ? st.defaultModelId : (choices.find((c) => c.tier === 'STANDARD') ?? choices[0]!).id;
    return { choices, defaultModelId: def, operationDefaults: ops, monthlyLimit: st.monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT, usage };
  }

  /** Uso do mês: só edições que custam (não usam o modelo embutido) e não falharam. */
  async usage(companyId: string) {
    const from = monthStart();
    const r = await this.prisma.mediaGeneration.aggregate({ where: { companyId, createdAt: { gte: from }, provider: { not: 'local' }, status: { not: 'FAILED' } }, _count: true, _sum: { cost: true } });
    return { month: new Date(from.getTime() - 3 * 3_600_000).toISOString().slice(0, 7), generations: r._count, cost: num(r._sum.cost) };
  }

  // ---------- Painel ----------
  async dto(companyId: string): Promise<AiSettingsDto> {
    const [accounts, st, usage, uses] = await Promise.all([
      this.prisma.aiAccount.findMany({ where: { companyId }, include: { models: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
      this.stored(companyId), this.usage(companyId),
      this.prisma.mediaGeneration.groupBy({ by: ['modelId'], where: { companyId, modelId: { not: null }, status: { not: 'FAILED' } }, _count: true }),
    ]);
    const usesBy = new Map(uses.map((u) => [u.modelId, u._count]));
    const order = { ECONOMIC: 0, STANDARD: 1, PREMIUM: 2 } as const;
    return {
      monthlyLimit: st.monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT, defaultModelId: st.defaultModelId ?? null, operationDefaults: st.operationDefaults ?? {}, usage,
      accounts: accounts.map((a): AiAccountDto => ({
        id: a.id, name: a.name, provider: a.provider as AiProviderId, providerLabel: AI_PROVIDER_CATALOG[a.provider as AiProviderId]?.label ?? a.provider, active: a.active, keyHint: `••••${this.apiKey(a.secrets).slice(-4)}`,
        models: a.models.sort((x, y) => x.kind.localeCompare(y.kind) || order[x.tier] - order[y.tier]).map((m): AiModelDto => ({ id: m.id, accountId: m.accountId, label: m.label, model: m.model, kind: m.kind, tier: m.tier, costUsd: num(m.costUsd), inputCostPerMTok: m.inputCostPerMTok == null ? null : num(m.inputCostPerMTok), outputCostPerMTok: m.outputCostPerMTok == null ? null : num(m.outputCostPerMTok), enabled: m.enabled, uses: usesBy.get(m.id) ?? 0 })),
      })),
      catalog: AI_PROVIDERS.map((id) => ({ id, ...AI_PROVIDER_CATALOG[id] })),
    };
  }

  // ---------- Contas ----------
  private baseUrl(provider: AiProviderId) {
    const url = { openai: this.env.OPENAI_API_URL, gemini: this.env.GEMINI_API_URL, anthropic: this.env.ANTHROPIC_API_URL, groq: this.env.GROQ_API_URL }[provider];
    return url.replace(/\/$/, '');
  }

  /** Provedores só de texto não podem ter modelos de imagem. */
  private assertKind(provider: string, kind: string) {
    if (kind === 'IMAGE' && AI_TEXT_ONLY_PROVIDERS.includes(provider as AiProviderId)) throw new AppException('AI_KIND_UNSUPPORTED', 400);
  }

  /** Lista os modelos da conta na API do provedor; falha se a chave não valer. */
  async discover(provider: AiProviderId, apiKey: string): Promise<DiscoveredModelDto[]> {
    try { return await discoverModels(provider, this.baseUrl(provider), apiKey); }
    catch (e) { const soft = e instanceof AiProviderError && e.kind !== 'auth'; throw new AppException('AI_KEY_INVALID', soft ? 502 : 400, soft ? (e as Error).message : undefined); }
  }

  /** Modelos disponíveis numa conta já cadastrada (marca os que já foram adicionados). */
  async discoverForAccount(companyId: string, id: string) {
    const a = await this.account(companyId, id);
    const [list, have] = await Promise.all([this.discover(a.provider as AiProviderId, this.apiKey(a.secrets)), this.prisma.aiModel.findMany({ where: { accountId: id }, select: { model: true } })]);
    const added = new Set(have.map((m) => m.model));
    return list.map((m) => ({ ...m, added: added.has(m.model) }));
  }

  async createAccount(ctx: AuthedCtx, input: AiAccountInput) {
    const { companyId } = ctx.user;
    await this.discover(input.provider, input.apiKey); // prova que a chave vale antes de guardar
    for (const m of input.models) this.assertKind(input.provider, m.kind);
    const seen = new Set<string>();
    const models = input.models.filter((m) => !seen.has(m.model) && !!seen.add(m.model));
    const acc = await this.prisma.aiAccount.create({
      data: {
        companyId, name: input.name, provider: input.provider, secrets: encryptJson({ apiKey: input.apiKey }, this.key), createdById: ctx.user.id,
        models: { create: models.map((m) => ({ companyId, label: m.label, model: m.model, kind: m.kind, tier: m.tier, costUsd: m.costUsd, inputCostPerMTok: m.inputCostPerMTok ?? null, outputCostPerMTok: m.outputCostPerMTok ?? null })) },
      },
    });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: acc.id, action: 'CREATE', after: { provider: 'AI_ACCOUNT', aiProvider: input.provider, name: input.name, models: models.map((m) => `${m.kind}:${m.model}`) }, ctx });
    return this.dto(companyId);
  }

  private async account(companyId: string, id: string) {
    const a = await this.prisma.aiAccount.findFirst({ where: { id, companyId } });
    if (!a) throw notFound('Conta de IA não encontrada.');
    return a;
  }

  async updateAccount(ctx: AuthedCtx, id: string, input: UpdateAiAccountInput) {
    const { companyId } = ctx.user;
    const a = await this.account(companyId, id);
    if (input.apiKey) await this.discover(a.provider as AiProviderId, input.apiKey);
    await this.prisma.aiAccount.update({ where: { id }, data: { ...(input.name && { name: input.name }), ...(input.active !== undefined && { active: input.active }), ...(input.apiKey && { secrets: encryptJson({ apiKey: input.apiKey }, this.key) }) } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: id, action: 'UPDATE', after: { provider: 'AI_ACCOUNT', name: input.name ?? a.name, active: input.active ?? a.active, keyChanged: !!input.apiKey }, ctx });
    return this.dto(companyId);
  }

  async removeAccount(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const a = await this.account(companyId, id);
    await this.prisma.aiAccount.delete({ where: { id } }); // os modelos caem em cascata; o histórico de edições continua
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: id, action: 'DELETE', before: { provider: 'AI_ACCOUNT', name: a.name }, ctx });
    return this.dto(companyId);
  }

  // ---------- Modelos ----------
  async addModel(ctx: AuthedCtx, accountId: string, input: AiModelInput) {
    const { companyId } = ctx.user;
    const acc = await this.account(companyId, accountId);
    this.assertKind(acc.provider, input.kind);
    if (await this.prisma.aiModel.findUnique({ where: { accountId_model: { accountId, model: input.model } } })) throw new AppException('AI_ACCOUNT_DUPLICATE', 409);
    await this.prisma.aiModel.create({ data: { companyId, accountId, label: input.label, model: input.model, kind: input.kind, tier: input.tier, costUsd: input.costUsd, inputCostPerMTok: input.inputCostPerMTok ?? null, outputCostPerMTok: input.outputCostPerMTok ?? null } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: accountId, action: 'UPDATE', after: { provider: 'AI_ACCOUNT', addedModel: input.model, tier: input.tier }, ctx });
    return this.dto(companyId);
  }

  private async model(companyId: string, id: string) {
    const m = await this.prisma.aiModel.findFirst({ where: { id, companyId } });
    if (!m) throw notFound('Modelo não encontrado.');
    return m;
  }

  async updateModel(ctx: AuthedCtx, id: string, input: UpdateAiModelInput) {
    const { companyId } = ctx.user;
    const m = await this.model(companyId, id);
    if (input.kind) this.assertKind((await this.account(companyId, m.accountId)).provider, input.kind);
    if (input.model && input.model !== m.model && (await this.prisma.aiModel.findUnique({ where: { accountId_model: { accountId: m.accountId, model: input.model } } }))) throw new AppException('AI_ACCOUNT_DUPLICATE', 409);
    await this.prisma.aiModel.update({ where: { id }, data: input });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: m.accountId, action: 'UPDATE', after: { provider: 'AI_ACCOUNT', model: input.model ?? m.model, ...input }, ctx });
    return this.dto(companyId);
  }

  async removeModel(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const m = await this.model(companyId, id);
    await this.prisma.aiModel.delete({ where: { id } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: m.accountId, action: 'UPDATE', after: { provider: 'AI_ACCOUNT', removedModel: m.model }, ctx });
    return this.dto(companyId);
  }

  // ---------- Modelos de texto ----------
  /** Modelos de texto ativos (para o agente de atendimento e usos futuros). */
  async textModels(companyId: string) {
    return this.prisma.aiModel.findMany({ where: { companyId, kind: 'TEXT', enabled: true, account: { active: true } }, include: { account: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Provedor de texto pronto para uso, ou `null` se o modelo não existe, está desativado ou não é de texto. */
  async textChoice(companyId: string, id: string): Promise<ResolvedText | null> {
    const m = await this.prisma.aiModel.findFirst({ where: { id, companyId, kind: 'TEXT', enabled: true, account: { active: true } }, include: { account: true } });
    if (!m || !isProvider(m.account.provider)) return null;
    const cfg = { baseUrl: this.baseUrl(m.account.provider), apiKey: this.apiKey(m.account.secrets), model: m.model, timeoutMs: this.env.AI_TIMEOUT_MS };
    return { id: m.id, providerId: m.account.provider, model: m.model, label: m.label, provider: m.account.provider === 'gemini' ? new GeminiText(cfg) : m.account.provider === 'anthropic' ? new AnthropicText(cfg) : new OpenAiText(cfg) /* Groq usa o mesmo formato da OpenAI */, inputCostPerMTok: num(m.inputCostPerMTok), outputCostPerMTok: num(m.outputCostPerMTok) };
  }

  // ---------- Padrões ----------
  async save(ctx: AuthedCtx, input: AiSettingsInput) {
    const { companyId } = ctx.user;
    const ids = [input.defaultModelId, ...Object.values(input.operationDefaults ?? {})].filter((x): x is string => !!x && x !== AI_LOCAL_MODEL_ID);
    if (ids.length) {
      const found = await this.prisma.aiModel.count({ where: { companyId, kind: 'IMAGE', id: { in: [...new Set(ids)] } } });
      if (found !== new Set(ids).size) throw new AppException('AI_MODEL_INVALID', 400);
    }
    const st = await this.stored(companyId);
    const next: Stored = {
      monthlyLimit: input.monthlyLimit ?? st.monthlyLimit ?? AI_DEFAULT_MONTHLY_LIMIT,
      defaultModelId: input.defaultModelId !== undefined ? input.defaultModelId : (st.defaultModelId ?? null),
      operationDefaults: input.operationDefaults ? Object.fromEntries(Object.entries({ ...(st.operationDefaults ?? {}), ...input.operationDefaults }).filter(([, v]) => !!v)) : st.operationDefaults,
    };
    await this.prisma.company.update({ where: { id: companyId }, data: { aiSettings: next as object } });
    await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'UPDATE', before: { ai: st }, after: { ai: next }, ctx });
    return this.dto(companyId);
  }
}

const ALL_OPS: AiOperation[] = ['ENHANCE', 'LIGHTING', 'REMOVE_OBJECT', 'REMOVE_FURNITURE', 'VIRTUAL_STAGE', 'SKY_REPLACEMENT'];

// ---------- Modelos de texto (agente de atendimento, textos futuros) ----------
export interface ResolvedText { id: string; provider: AITextProvider; providerId: AiProviderId; model: string; label: string; inputCostPerMTok: number; outputCostPerMTok: number }
