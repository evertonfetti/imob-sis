import { z } from 'zod';

/** Bloco 11 (SaaS) — Fase 1: protocolo entre a instalação do cliente e o servidor de licenças. */

export const LICENSE_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  TRIALING: 'Em teste', ACTIVE: 'Ativa', PAST_DUE: 'Pagamento atrasado', SUSPENDED: 'Suspensa', CANCELED: 'Cancelada',
};
/** Status que liberam o uso normal da instalação. Qualquer outro bloqueia. */
export const LICENSE_OK_STATUSES: LicenseStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

export const BILLING_INTERVALS = ['MONTHLY', 'YEARLY'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = { MONTHLY: 'Mensal', YEARLY: 'Anual' };

/** Limites de um plano. Todos opcionais: ausente = sem limite nesse recurso. */
export interface PlanLimits {
  maxUsers?: number;
  maxProperties?: number;
  maxBranches?: number;
  maxSocialAccounts?: number;
  maxAiAccounts?: number;
  maxWhatsappSendsMonth?: number;
  aiAgent?: boolean;
}
export const PLAN_LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  maxUsers: 'Usuários', maxProperties: 'Imóveis', maxBranches: 'Filiais', maxSocialAccounts: 'Contas de redes sociais',
  maxAiAccounts: 'Contas de IA', maxWhatsappSendsMonth: 'Envios de WhatsApp por mês', aiAgent: 'Agente de atendimento por IA',
};

/** Contagem de uso que a instalação relata a cada confirmação. Tudo opcional: relate o que já souber calcular. */
export interface UsageCounts {
  users?: number;
  properties?: number;
  branches?: number;
  socialAccounts?: number;
  aiAccounts?: number;
  whatsappSendsMonth?: number;
}

export const heartbeatSchema = z.object({
  instanceFingerprint: z.string().trim().min(8).max(200),
  version: z.string().trim().max(60).optional().nullable(),
  instanceUrl: z.string().trim().max(300).optional().nullable(),
  counts: z
    .object({
      users: z.number().int().min(0).optional(),
      properties: z.number().int().min(0).optional(),
      branches: z.number().int().min(0).optional(),
      socialAccounts: z.number().int().min(0).optional(),
      aiAccounts: z.number().int().min(0).optional(),
      whatsappSendsMonth: z.number().int().min(0).optional(),
    })
    .default({}),
});
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export interface HeartbeatResponse {
  status: LicenseStatus;
  ok: boolean; // atalho: LICENSE_OK_STATUSES.includes(status)
  planKey: string;
  planName: string;
  limits: PlanLimits;
  message: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  checkAgainInSeconds: number;
}

/** Estado de licença guardado localmente pela instalação do cliente (packages/database, tabela LicenseState). */
export interface LocalLicenseState {
  status: LicenseStatus;
  ok: boolean;
  planName: string;
  limits: PlanLimits;
  message: string | null;
  lastCheckedAt: string | null;
  lastOkAt: string | null;
}

// ---------- Painel master (apps/license-panel) ----------
export const planInputSchema = z.object({
  key: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Use letras minúsculas, números e hífen'),
  name: z.string().trim().min(2).max(80),
  priceCents: z.number().int().min(0),
  billingInterval: z.enum(BILLING_INTERVALS),
  limits: z.object({
    maxUsers: z.number().int().min(0).optional(),
    maxProperties: z.number().int().min(0).optional(),
    maxBranches: z.number().int().min(0).optional(),
    maxSocialAccounts: z.number().int().min(0).optional(),
    maxAiAccounts: z.number().int().min(0).optional(),
    maxWhatsappSendsMonth: z.number().int().min(0).optional(),
    aiAgent: z.boolean().optional(),
  }),
  active: z.boolean().optional(),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export const clientInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(160).optional().nullable(),
  contactEmail: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('')),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const licenseInputSchema = z.object({
  clientId: z.string().uuid(),
  planId: z.string().uuid(),
  trialDays: z.number().int().min(0).max(365).optional(),
});
export type LicenseInput = z.infer<typeof licenseInputSchema>;

export const licenseStatusInputSchema = z.object({
  status: z.enum(LICENSE_STATUSES),
  reason: z.string().trim().max(300).optional().nullable(),
});
export type LicenseStatusInput = z.infer<typeof licenseStatusInputSchema>;

export interface PlanDto {
  id: string; key: string; name: string; priceCents: number; billingInterval: BillingInterval; limits: PlanLimits; active: boolean; licenseCount: number;
}
export interface ClientDto {
  id: string; name: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; notes: string | null; createdAt: string; licenses: LicenseSummaryDto[];
}
export interface LicenseSummaryDto {
  id: string; status: LicenseStatus; planName: string; keyPreview: string; lastSeenAt: string | null; currentPeriodEnd: string | null;
}

// ---------- Fase 2: cobrança (Mercado Pago) ----------
export const BILLING_MODES = ['AUTO', 'MANUAL'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];
export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  AUTO: 'Automática (Mercado Pago)', MANUAL: 'Manual (você controla o status)',
};

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: 'Aguardando pagamento', PAID: 'Paga', EXPIRED: 'Vencida', CANCELED: 'Cancelada',
};

export interface InvoiceDto {
  id: string; periodStart: string; periodEnd: string; amountCents: number; status: InvoiceStatus;
  dueAt: string; checkoutUrl: string | null; paidAt: string | null; createdAt: string;
}

export const billingModeInputSchema = z.object({ billingMode: z.enum(BILLING_MODES) });
export type BillingModeInput = z.infer<typeof billingModeInputSchema>;

export interface LicenseDetailDto extends LicenseSummaryDto {
  clientId: string; clientName: string; planId: string; trialEndsAt: string | null; suspendedAt: string | null; suspendReason: string | null;
  instanceFingerprint: string | null; instanceVersion: string | null; instanceUrl: string | null; createdAt: string;
  billingMode: BillingMode; billingEnabled: boolean;
  usage: { reportedAt: string; counts: UsageCounts }[];
  events: { id: string; type: string; message: string; createdAt: string; staffName: string | null }[];
  invoices: InvoiceDto[];
}
/** Só aparece na resposta da criação (ou de "gerar nova chave") — depois disso, só o preview. */
export interface LicenseCreatedDto extends LicenseDetailDto {
  key: string;
}

export interface StaffAuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  staff: { id: string; name: string; email: string };
}
