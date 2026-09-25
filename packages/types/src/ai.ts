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

export const AI_PROVIDERS = ['local', 'gemini', 'openai'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const AI_PROVIDER_INFO: Record<AiProviderId, { label: string; needsKey: boolean; defaultModel: string | null; note: string; estimatedCostUsd: number }> = {
  local: { label: 'Básico (no servidor, sem custo)', needsKey: false, defaultModel: null, note: 'Melhora foto e iluminação. Não remove objetos nem decora.', estimatedCostUsd: 0 },
  gemini: { label: 'Google Gemini', needsKey: true, defaultModel: 'gemini-3.1-flash-image', note: 'Todas as operações. Chave em aistudio.google.com.', estimatedCostUsd: 0.04 },
  openai: { label: 'OpenAI (gpt-image)', needsKey: true, defaultModel: 'gpt-image-1.5', note: 'Todas as operações. Chave em platform.openai.com.', estimatedCostUsd: 0.08 },
};
export const AI_DEFAULT_MONTHLY_LIMIT = 100;

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().max(80).optional().nullable(),
  // Em branco = mantém a chave já salva (ela nunca volta para a tela).
  apiKey: z.string().trim().min(10, 'Chave inválida').max(300).optional(),
  monthlyLimit: z.number().int().min(1).max(10000).optional(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export const createGenerationSchema = z.object({
  operation: z.enum(AI_OPERATIONS),
  prompt: z.string().trim().max(500).optional().nullable(),
  style: z.enum(STAGING_STYLES).optional(),
  /** Continua a partir de uma versão anterior (padrão: a foto original). */
  parentId: z.string().uuid().optional().nullable(),
});
export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;

export interface MediaGenerationDto {
  id: string; mediaId: string; parentId: string | null; operation: AiOperation; status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  provider: string; model: string | null; prompt: string | null; style: string | null; outputUrl: string | null; thumbUrl: string | null;
  cost: number | null; error: string | null; durationMs: number | null; active: boolean; approvedAt: string | null; createdAt: string;
}
export interface MediaVersionsDto { mediaId: string; originalUrl: string | null; activeGenerationId: string | null; generations: MediaGenerationDto[] }
export interface AiSettingsDto {
  provider: AiProviderId; model: string | null; keySet: boolean; monthlyLimit: number;
  usage: { month: string; generations: number; cost: number };
  providers: { id: AiProviderId; label: string; needsKey: boolean; defaultModel: string | null; note: string }[];
}

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
