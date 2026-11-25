import { z } from 'zod';

/** Eventos que o sistema envia à Meta (spec §48). */
export const META_EVENTS = ['Lead', 'QualifiedLead', 'Contact', 'Schedule', 'Purchase'] as const;
export type MetaEvent = (typeof META_EVENTS)[number];

/** Eventos que podem ser ligados a uma etapa do funil (Lead e Contact nascem de outras ações). */
export const STAGE_META_EVENTS = ['QualifiedLead', 'Schedule', 'Purchase'] as const;

export const META_EVENT_LABELS: Record<MetaEvent, string> = {
  Lead: 'Lead (formulário do site)',
  QualifiedLead: 'Lead qualificado',
  Contact: 'Contato (WhatsApp)',
  Schedule: 'Visita agendada',
  Purchase: 'Compra / fechamento',
};

export const MARKETING_EVENT_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type MarketingEventStatus = (typeof MARKETING_EVENT_STATUSES)[number];

const pixelIdField = z.string().trim().regex(/^\d{5,25}$/, 'O ID do Pixel tem apenas dígitos');
const tokenField = z.string().trim().min(20, 'Token muito curto').max(1000);
const testCodeField = z.string().trim().max(40).optional().nullable().or(z.literal(''));

/** Cadastro de um Pixel: cada Pixel tem o seu token da Conversions API. */
export const createMetaPixelSchema = z.object({
  pixelId: pixelIdField,
  accessToken: tokenField,
  name: z.string().trim().max(60).optional().nullable().or(z.literal('')),
  testEventCode: testCodeField,
});
export type CreateMetaPixelInput = z.infer<typeof createMetaPixelSchema>;

export const updateMetaPixelSchema = z.object({
  accessToken: tokenField.optional(),
  name: z.string().trim().max(60).optional().nullable().or(z.literal('')),
  testEventCode: testCodeField,
  active: z.boolean().optional(),
});
export type UpdateMetaPixelInput = z.infer<typeof updateMetaPixelSchema>;

export interface MetaPixelDto {
  id: string;
  pixelId: string;
  name: string | null;
  active: boolean;
  testEventCode: string | null;
  accessTokenSet: true;
}

/** Monitoramento de um Pixel, lido da API da Meta + o que o sistema enviou nas últimas 24 h. */
export interface MetaPixelMonitor {
  id: string;
  pixelId: string;
  name: string | null;
  active: boolean;
  /** Dados do Pixel na Meta. `null` + `metaError` quando o token não permite a leitura. */
  lastFiredTime: string | null;
  isUnavailable: boolean | null;
  metaError: string | null;
  /** Eventos recebidos pela Meta nas últimas 24 h, por nome. `null` + `statsError` se o token não permite ler estatísticas. */
  stats: { event: string; total: number }[] | null;
  /** De onde a Meta recebeu os eventos (navegador x servidor): ideal é haver os dois, com deduplicação. */
  sources: { browser: number; server: number } | null;
  statsError: string | null;
  /** O que o nosso servidor enviou a este Pixel nas últimas 24 h. */
  sent24h: { sent: number; failed: number; pending: number };
  lastError: string | null;
}

/** Eventos de navegação espelhados no servidor (Conversions API) com o mesmo event_id do Pixel. */
export const PIXEL_MIRROR_EVENTS = ['PageView', 'ViewContent', 'Search', 'ViewCategory', 'Contact', 'PropertyCardClick', 'ShareProperty'] as const;
const pixelParam = z.union([z.string().max(300), z.number(), z.boolean(), z.array(z.string().max(100)).max(10)]);
export const pixelMirrorSchema = z.object({
  name: z.enum(PIXEL_MIRROR_EVENTS),
  eventId: z.string().trim().min(8).max(80),
  params: z.record(z.string().max(40), pixelParam).refine((o) => Object.keys(o).length <= 20, 'Parâmetros demais').optional(),
  pageUrl: z.string().trim().max(500).optional().nullable(),
  fbc: z.string().trim().max(300).optional().nullable(),
  fbp: z.string().trim().max(300).optional().nullable(),
  visitorId: z.string().trim().max(80).optional().nullable(),
});
export type PixelMirrorInput = z.infer<typeof pixelMirrorSchema>;

export const marketingPeriodSchema = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90, 365].includes(n), 'Período inválido').default(30) });

export const listMarketingEventsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(MARKETING_EVENT_STATUSES).optional(),
  eventName: z.enum(META_EVENTS).optional(),
});

export interface CampaignRow {
  campaign: string;
  source: string;
  medium: string;
  leads: number;
  qualified: number;
  won: number;
  lost: number;
  whatsappClicks: number;
  wonValue: number;
  qualifiedRate: number; // 0..1
  wonRate: number; // 0..1
}

export interface SourceRow { key: string; label: string; leads: number; qualified: number; won: number; qualifiedRate: number; wonRate: number }
