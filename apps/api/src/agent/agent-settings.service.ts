import { Injectable } from '@nestjs/common';
import { DEFAULT_AGENT_SETTINGS, resolveAgentSettings, type AgentRunDto, type AgentSettings, type AgentSettingsDto, type UpdateAgentSettingsInput } from '@imob/types';
import { AiSettingsService, monthStart } from '../ai/ai-settings.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../whatsapp/integrations.service';

/** Configuração do agente de atendimento por IA (por empresa). */
@Injectable()
export class AgentSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiSettingsService, private readonly audit: AuditService, private readonly whatsapp: IntegrationsService) {}

  async get(companyId: string): Promise<AgentSettings> {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { agentSettings: true } });
    return resolveAgentSettings(c?.agentSettings);
  }

  async usage(companyId: string) {
    const from = monthStart();
    const [replied, handoffs, cost] = await Promise.all([
      this.prisma.aiAgentRun.count({ where: { companyId, createdAt: { gte: from }, outcome: { in: ['REPLIED', 'HANDOFF'] } } }),
      this.prisma.aiAgentRun.count({ where: { companyId, createdAt: { gte: from }, outcome: 'HANDOFF' } }),
      this.prisma.aiAgentRun.aggregate({ where: { companyId, createdAt: { gte: from } }, _sum: { costUsd: true } }),
    ]);
    return { month: new Date(from.getTime() - 3 * 3_600_000).toISOString().slice(0, 7), replies: replied, handoffs, costUsd: Number(cost._sum.costUsd ?? 0) };
  }

  async dto(companyId: string): Promise<AgentSettingsDto> {
    const [settings, models, usage, connected] = await Promise.all([this.get(companyId), this.ai.textModels(companyId), this.usage(companyId), this.whatsapp.isConnected(companyId)]);
    return {
      settings, defaults: DEFAULT_AGENT_SETTINGS, usage, whatsappConnected: connected,
      textModels: models.map((m) => ({ id: m.id, label: m.label, model: m.model, tier: m.tier, accountName: m.account.name, provider: m.account.provider, priced: m.inputCostPerMTok != null && m.outputCostPerMTok != null })),
    };
  }

  async update(ctx: AuthedCtx, input: UpdateAgentSettingsInput) {
    const { companyId } = ctx.user;
    const before = await this.get(companyId);
    const next = { ...before, ...input };
    if (next.modelId && !(await this.ai.textChoice(companyId, next.modelId))) throw new AppException('AGENT_MODEL_INVALID', 400);
    if (next.enabled && !next.modelId) throw new AppException('AGENT_MODEL_REQUIRED', 400);
    await this.prisma.company.update({ where: { id: companyId }, data: { agentSettings: next } });
    await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'UPDATE', before: { agent: { ...before, instructions: undefined } }, after: { agent: { ...next, instructions: undefined }, instructionsChanged: before.instructions !== next.instructions }, ctx });
    return this.dto(companyId);
  }

  async runs(companyId: string, limit = 30): Promise<AgentRunDto[]> {
    const rows = await this.prisma.aiAgentRun.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: limit });
    const convIds = [...new Set(rows.map((r) => r.conversationId).filter((x): x is string => !!x))];
    const convs = convIds.length ? await this.prisma.conversation.findMany({ where: { id: { in: convIds }, companyId }, select: { id: true, contactName: true } }) : [];
    const names = new Map(convs.map((c) => [c.id, c.contactName]));
    return rows.map((r) => ({
      id: r.id, conversationId: r.conversationId, contactName: r.conversationId ? (names.get(r.conversationId) ?? null) : null, model: r.model, outcome: r.outcome,
      actions: ((r.actions ?? []) as { type: string }[]).map((a) => a.type), inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: Number(r.costUsd), error: r.error, createdAt: r.createdAt.toISOString(),
    }));
  }
}
