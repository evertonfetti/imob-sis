import { z } from 'zod';

// ---------- IA de imagens (spec §21–23) ----------
export const AI_OPERATIONS = ['ENHANCE', 'LIGHTING', 'REMOVE_OBJECT', 'REMOVE_FURNITURE', 'VIRTUAL_STAGE', 'SKY_REPLACEMENT'] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];
export const AI_OPERATION_LABELS: Record<AiOperation, string> = {
  ENHANCE: 'Melhorar a foto', LIGHTING: 'Melhorar a iluminação', REMOVE_OBJECT: 'Remover objeto', REMOVE_FURNITURE: 'Esvaziar o ambiente', VIRTUAL_STAGE: 'Decorar (virtual staging)', SKY_REPLACEMENT: 'Trocar o céu',
};
export const AI_OPERATION_HINTS: Record<AiOperation, string> = {
  ENHANCE: 'Nitidez, cor e contraste mais naturais.', LIGHTING: 'Ambiente mais claro e equilibrado, sem estourar as janelas.',
  REMOVE_OBJECT: 'Diga o que remover (ex.: carro na garagem, fios, lixeira).', REMOVE_FURNITURE: 'Tira os móveis e mostra o espaço vazio.',
  VIRTUAL_STAGE: 'Mobília o ambiente vazio no estilo escolhido.', SKY_REPLACEMENT: 'Céu azul e limpo em fotos externas.',
};
export const STAGING_STYLES = ['moderno', 'classico', 'escandinavo', 'industrial', 'minimalista', 'rustico'] as const;
export const STAGING_STYLE_LABELS: Record<(typeof STAGING_STYLES)[number], string> = { moderno: 'Moderno', classico: 'Clássico', escandinavo: 'Escandinavo', industrial: 'Industrial', minimalista: 'Minimalista', rustico: 'Rústico' };
/** Operações que só fazem sentido com um provedor generativo (o modo "local" não as executa). */
export const AI_GENERATIVE_ONLY: AiOperation[] = ['REMOVE_OBJECT', 'REMOVE_FURNITURE', 'VIRTUAL_STAGE', 'SKY_REPLACEMENT'];

/** Modelo embutido no sistema: roda no servidor, sem chave nem custo (só melhora foto e iluminação). */
export const AI_LOCAL_MODEL_ID = 'local';
export const AI_LOCAL_OPERATIONS: AiOperation[] = ['ENHANCE', 'LIGHTING'];

export const AI_PROVIDERS = ['openai', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const AI_MODEL_KINDS = ['IMAGE', 'TEXT'] as const;
export type AiModelKind = (typeof AI_MODEL_KINDS)[number];
export const AI_MODEL_KIND_LABELS: Record<AiModelKind, string> = { IMAGE: 'Editar imagens', TEXT: 'Gerar texto / conversar' };
export const AI_TIERS = ['ECONOMIC', 'STANDARD', 'PREMIUM'] as const;
export type AiTier = (typeof AI_TIERS)[number];
export const AI_TIER_LABELS: Record<AiTier, string> = { ECONOMIC: 'Econômico', STANDARD: 'Padrão', PREMIUM: 'Premium' };
export const AI_TIER_HINTS: Record<AiTier, string> = { ECONOMIC: 'Mais rápido e barato; bom para ajustes simples.', STANDARD: 'Equilíbrio entre qualidade e custo.', PREMIUM: 'Melhor qualidade; use para decorar e remover objetos difíceis.' };

/** Provedores suportados. Os modelos vêm da própria conta (listados pela API do provedor quando a chave é cadastrada). */
export const AI_PROVIDER_CATALOG: Record<AiProviderId, { label: string; note: string }> = {
  openai: { label: 'OpenAI (GPT)', note: 'Chave em platform.openai.com → API keys.' },
  gemini: { label: 'Google Gemini', note: 'Chave em aistudio.google.com → Get API key.' },
};
/** Custos conhecidos (estimativa, em US$) para pré-preencher; o usuário confirma ou corrige. Imagem = por imagem; texto = por milhão de tokens. */
export const AI_KNOWN_COSTS: { match: RegExp; costUsd?: number; inputCostPerMTok?: number; outputCostPerMTok?: number }[] = [
  { match: /^gpt-image-1\.5/, costUsd: 0.13 }, { match: /^gpt-image-1-mini/, costUsd: 0.02 }, { match: /^gpt-image-1/, costUsd: 0.08 },
  { match: /^gemini-.*image/, costUsd: 0.04 },
];

export const AI_DEFAULT_MONTHLY_LIMIT = 100;
const modelId = z.string().uuid().or(z.literal(AI_LOCAL_MODEL_ID));
export const updateAiAccountSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  // Em branco = mantém a chave já salva (ela nunca volta para a tela).
  apiKey: z.string().trim().min(10, 'Chave inválida').max(300).optional(),
  active: z.boolean().optional(),
});
const modelBody = {
  label: z.string().trim().min(2, 'Dê um nome ao modelo').max(80),
  model: z.string().trim().min(2, 'Informe o ID do modelo').max(120).regex(/^[\w.\-:/]+$/, 'Use só letras, números e . - _ : /'),
  kind: z.enum(AI_MODEL_KINDS),
  tier: z.enum(AI_TIERS),
  /** Por imagem (modelos de imagem). */
  costUsd: z.number().min(0).max(20),
  /** Por milhão de tokens (modelos de texto): sem isso o gasto do agente não é calculado. */
  inputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
  outputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
};
export const aiModelSchema = z.object(modelBody);
export const updateAiModelSchema = z.object(modelBody).partial().extend({ enabled: z.boolean().optional() });
/** Conta nova já com os modelos escolhidos na lista que o provedor devolveu. */
export const aiAccountSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome à conta').max(60),
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().trim().min(10, 'Chave inválida').max(300),
  models: z.array(aiModelSchema).max(80).default([]),
});
export const aiDiscoverSchema = z.object({ provider: z.enum(AI_PROVIDERS), apiKey: z.string().trim().min(10, 'Chave inválida').max(300) });
export type AiDiscoverInput = z.infer<typeof aiDiscoverSchema>;
export interface DiscoveredModelDto {
  model: string; label: string;
  /** "OTHER" = o provedor listou, mas não parece gerar imagem nem texto (embeddings, áudio…); dá para adicionar mesmo assim. */
  guess: AiModelKind | 'OTHER'; tier: AiTier; costUsd: number; inputCostPerMTok: number | null; outputCostPerMTok: number | null; added: boolean;
}
export const aiSettingsSchema = z.object({
  monthlyLimit: z.number().int().min(1).max(10000).optional(),
  /** Modelo padrão quando o usuário não escolhe (null = o embutido/sem custo). */
  defaultModelId: modelId.nullable().optional(),
  /** Modelo padrão por tipo de edição (ex.: econômico para melhorar, premium para decorar). */
  operationDefaults: z.object(Object.fromEntries(AI_OPERATIONS.map((op) => [op, modelId.nullable().optional()])) as Record<AiOperation, z.ZodOptional<z.ZodNullable<typeof modelId>>>).strict().optional(),
});
export type AiAccountInput = z.infer<typeof aiAccountSchema>;
export type UpdateAiAccountInput = z.infer<typeof updateAiAccountSchema>;
export type AiModelInput = z.infer<typeof aiModelSchema>;
export type UpdateAiModelInput = z.infer<typeof updateAiModelSchema>;
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export const createGenerationSchema = z.object({
  operation: z.enum(AI_OPERATIONS),
  prompt: z.string().trim().max(500).optional().nullable(),
  style: z.enum(STAGING_STYLES).optional(),
  /** Continua a partir de uma versão anterior (padrão: a foto original). */
  parentId: z.string().uuid().optional().nullable(),
  /** Modelo escolhido (id do cadastro ou "local"); sem isso vale o padrão da operação/da empresa. */
  modelId: modelId.optional(),
});
export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;

export interface MediaGenerationDto {
  id: string; mediaId: string; parentId: string | null; operation: AiOperation; status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  provider: string; model: string | null; accountName: string | null; prompt: string | null; style: string | null; outputUrl: string | null; thumbUrl: string | null;
  cost: number | null; error: string | null; durationMs: number | null; active: boolean; approvedAt: string | null; createdAt: string;
}
export interface MediaVersionsDto { mediaId: string; originalUrl: string | null; activeGenerationId: string | null; generations: MediaGenerationDto[] }
export interface AiModelDto { id: string; accountId: string; label: string; model: string; kind: AiModelKind; tier: AiTier; costUsd: number; inputCostPerMTok: number | null; outputCostPerMTok: number | null; enabled: boolean; uses: number }
export interface AiAccountDto { id: string; name: string; provider: AiProviderId; providerLabel: string; active: boolean; keyHint: string; models: AiModelDto[] }
export interface AiUsageDto { month: string; generations: number; cost: number }
export interface AiSettingsDto {
  monthlyLimit: number; defaultModelId: string | null; operationDefaults: Partial<Record<AiOperation, string | null>>;
  usage: AiUsageDto; accounts: AiAccountDto[];
  catalog: { id: AiProviderId; label: string; note: string }[];
}
/** Opções que o estúdio de edição oferece (só o que está ativo). */
export interface AiChoiceDto { id: string; label: string; provider: string; accountName: string | null; tier: AiTier | null; costUsd: number; operations: AiOperation[] }
export interface AiStatusDto { choices: AiChoiceDto[]; defaultModelId: string; operationDefaults: Partial<Record<AiOperation, string>>; monthlyLimit: number; usage: AiUsageDto }

// ---------- Marca d'água ----------
export const WATERMARK_POSITIONS = ['BOTTOM_RIGHT', 'BOTTOM_LEFT', 'TOP_RIGHT', 'TOP_LEFT', 'CENTER'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];
export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = { BOTTOM_RIGHT: 'Canto inferior direito', BOTTOM_LEFT: 'Canto inferior esquerdo', TOP_RIGHT: 'Canto superior direito', TOP_LEFT: 'Canto superior esquerdo', CENTER: 'Centro' };
export const DEFAULT_WATERMARK = { enabled: false, position: 'BOTTOM_RIGHT' as WatermarkPosition, opacity: 70, scale: 18, margin: 3 };
export type WatermarkSettings = typeof DEFAULT_WATERMARK;
export const watermarkSettingsSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(WATERMARK_POSITIONS),
  /** Opacidade da logo, em %. */
  opacity: z.number().int().min(10).max(100),
  /** Largura da logo em % da largura da foto. */
  scale: z.number().int().min(5).max(40),
  /** Distância da borda em % da largura da foto. */
  margin: z.number().int().min(0).max(10),
}).partial();
export type UpdateWatermarkInput = z.infer<typeof watermarkSettingsSchema>;
export function resolveWatermark(saved: unknown): WatermarkSettings {
  const p = watermarkSettingsSchema.safeParse(saved && typeof saved === 'object' ? saved : {});
  return { ...DEFAULT_WATERMARK, ...(p.success ? p.data : {}) };
}
export const logoUploadSchema = z.object({ contentType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']), sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024) });
export const logoConfirmSchema = z.object({ key: z.string().min(10).max(300) });
export type LogoUploadInput = z.infer<typeof logoUploadSchema>;
export interface WatermarkDto {
  settings: WatermarkSettings; logoUrl: string | null; hasLogo: boolean;
  /** Fotos publicadas com uma versão anterior da marca (precisam ser reaplicadas). */
  outdatedPhotos: number; totalPhotos: number;
}
