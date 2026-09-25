import { z } from 'zod';

// ---------- Lead score (regras, sem IA — spec §37) ----------
export const LEAD_SCORE_FACTORS = [
  { key: 'BUDGET', label: 'Informou orçamento', points: 10 },
  { key: 'WHATSAPP', label: 'Respondeu no WhatsApp', points: 10 },
  { key: 'VISIT_REQUESTED', label: 'Solicitou visita', points: 15 },
  { key: 'VISIT_SCHEDULED', label: 'Visita agendada', points: 20 },
  { key: 'VISIT_DONE', label: 'Realizou visita', points: 25 },
  { key: 'PROPOSAL', label: 'Fez proposta', points: 30 },
] as const;
export type LeadScoreFactorKey = (typeof LEAD_SCORE_FACTORS)[number]['key'];
export const LEAD_SCORE_MAX = 100;
export const HOT_SCORE = 60;
export const WARM_SCORE = 30;
export type LeadTemperature = 'COLD' | 'WARM' | 'HOT';
export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { COLD: 'Frio', WARM: 'Morno', HOT: 'Quente' };
export const temperatureOf = (score: number): LeadTemperature => (score >= HOT_SCORE ? 'HOT' : score >= WARM_SCORE ? 'WARM' : 'COLD');

export interface LeadScoreDto {
  score: number;
  temperature: LeadTemperature;
  factors: { key: LeadScoreFactorKey; label: string; points: number; earned: boolean }[];
}

// ---------- Matching (spec §38) ----------
export interface PropertyMatchDto {
  propertyId: string;
  score: number;
  reasons: string[];
  property: { id: string; code: string; title: string; purpose: string; city: string | null; neighborhood: string | null; bedrooms: number | null; price: number | null; coverUrl: string | null };
}
export interface LeadMatchDto {
  leadId: string;
  score: number;
  reasons: string[];
  lead: { id: string; customerName: string; brokerName: string | null; status: string; scoreValue: number };
}
export interface MatchResult<T> {
  items: T[];
  /** Critérios que existiam para comparar (ex.: "orçamento", "região"). Vazio = faltam dados. */
  criteria: string[];
  insufficientData: boolean;
}
export const MATCH_MIN_SCORE = 50;
export const MATCH_AUTO_TASK_SCORE = 75;

// ---------- Alertas ----------
export const ALERT_TYPES = [
  'LEAD_UNATTENDED', 'LEAD_STALE', 'TASKS_OVERDUE', 'VISIT_UNCONFIRMED', 'VISIT_NO_OUTCOME', 'PROPOSAL_EXPIRING', 'PROPOSAL_IDLE', 'WHATSAPP_WAITING',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export interface AlertDto {
  id: string;
  type: AlertType;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  href: string;
  since: string | null;
}

// ---------- Relatórios ----------
export const reportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface ReportOverviewDto {
  range: { from: string; to: string };
  kpis: { newLeads: number; wonLeads: number; lostLeads: number; openLeads: number; conversionRate: number; avgDaysToClose: number | null; visitsDone: number; proposals: number; dealValue: number };
  bySource: { source: string; leads: number; won: number }[];
  byDay: { date: string; leads: number }[];
  funnel: { stageId: string; name: string; color: string; reached: number }[];
  topProperties: { propertyId: string; code: string; title: string; leads: number; visits: number; proposals: number }[];
  lostReasons: { reason: string; count: number }[];
  brokers: { brokerId: string | null; name: string; leads: number; visitsDone: number; proposals: number; won: number; avgScore: number }[] | null;
}
