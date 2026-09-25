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

export const metaIntegrationSchema = z.object({
  pixelId: z.string().trim().regex(/^\d{5,25}$/, 'O ID do Pixel tem apenas dígitos').optional(),
  accessToken: z.string().trim().min(20, 'Token muito curto').max(1000).optional(),
  testEventCode: z.string().trim().max(40).optional().nullable().or(z.literal('')),
});
export type MetaIntegrationInput = z.infer<typeof metaIntegrationSchema>;

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
