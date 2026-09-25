import { z } from 'zod';

// ---------- Agente de atendimento por IA ----------
export const AGENT_LIMITS = { maxReplies: [1, 200], maxPhotos: [0, 8], replyDelaySec: [0, 30], returnToBotAfterHours: [0, 720] } as const;
export const DEFAULT_AGENT_SETTINGS = {
  enabled: false,
  name: 'Assistente virtual',
  /** Modelo de texto (cadastro em Empresa → Imagens e IA → contas). */
  modelId: null as string | null,
  /** Orientações extras da imobiliária (tom, regras, o que nunca prometer…). */
  instructions: '',
  handoffMessage: 'Certo! Vou chamar um de nossos corretores para continuar com você. Ele responde em breve. 🙂',
  /** Máximo de respostas automáticas por conversa; passando disso, transfere para uma pessoa. */
  maxReplies: 30,
  /** Fotos enviadas de uma vez (0 = o agente não envia fotos). */
  maxPhotos: 4,
  /** Espera antes de responder (junta mensagens seguidas e parece mais natural). */
  replyDelaySec: 4,
  /** Conversa com uma pessoa parada há mais que isso volta ao assistente na próxima mensagem do cliente (0 = só quando alguém devolver ou finalizar). */
  returnToBotAfterHours: 0,
};
export type AgentSettings = typeof DEFAULT_AGENT_SETTINGS;
export const agentSettingsSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(2).max(40),
  modelId: z.string().uuid().nullable(),
  instructions: z.string().trim().max(3000),
  handoffMessage: z.string().trim().min(3).max(300),
  maxReplies: z.number().int().min(AGENT_LIMITS.maxReplies[0]).max(AGENT_LIMITS.maxReplies[1]),
  maxPhotos: z.number().int().min(AGENT_LIMITS.maxPhotos[0]).max(AGENT_LIMITS.maxPhotos[1]),
  replyDelaySec: z.number().int().min(AGENT_LIMITS.replyDelaySec[0]).max(AGENT_LIMITS.replyDelaySec[1]),
  returnToBotAfterHours: z.number().int().min(AGENT_LIMITS.returnToBotAfterHours[0]).max(AGENT_LIMITS.returnToBotAfterHours[1]),
}).partial();
export type UpdateAgentSettingsInput = z.infer<typeof agentSettingsSchema>;
export function resolveAgentSettings(saved: unknown): AgentSettings {
  const p = agentSettingsSchema.safeParse(saved && typeof saved === 'object' ? saved : {});
  return { ...DEFAULT_AGENT_SETTINGS, ...(p.success ? p.data : {}) } as AgentSettings;
}

/** O que o agente pode pedir ao sistema além de responder (validado no servidor antes de executar). */
export const AGENT_ACTION_TYPES = ['send_photos', 'handoff', 'update_lead', 'request_visit'] as const;
export const agentTestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) })).min(1).max(20),
  propertyId: z.string().uuid().optional().nullable(),
});
export type AgentTestInput = z.infer<typeof agentTestSchema>;

export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const documentUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(DOCUMENT_MAX_BYTES),
});
export const documentConfirmSchema = z.object({ key: z.string().min(10).max(300), title: z.string().trim().min(2).max(120).optional(), filename: z.string().trim().min(1).max(200), contentType: z.enum(DOCUMENT_CONTENT_TYPES) });
export const updateDocumentSchema = z.object({ title: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() });
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type DocumentConfirmInput = z.infer<typeof documentConfirmSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export interface AiDocumentDto { id: string; title: string; filename: string; mime: string; sizeBytes: number; status: 'PROCESSING' | 'READY' | 'FAILED'; error: string | null; charCount: number; chunks: number; active: boolean; createdAt: string }
export interface AgentTextModelDto { id: string; label: string; model: string; tier: string; accountName: string; provider: string; priced: boolean }
export interface AgentSettingsDto {
  settings: AgentSettings; defaults: AgentSettings; textModels: AgentTextModelDto[];
  usage: { month: string; replies: number; handoffs: number; costUsd: number };
  whatsappConnected: boolean;
}
export interface AgentRunDto { id: string; conversationId: string | null; contactName: string | null; model: string; outcome: string; actions: string[]; inputTokens: number; outputTokens: number; costUsd: number; error: string | null; createdAt: string }
export interface AgentTestResult {
  reply: string; actions: { type: string; detail: string }[]; handoff: boolean;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  /** Trechos de documentos que o agente recebeu como contexto. */
  sources: { document: string; excerpt: string }[];
}
