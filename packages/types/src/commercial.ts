import { z } from 'zod';

// ---------- Visitas ----------
export const VISIT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  SCHEDULED: 'Agendada', CONFIRMED: 'Confirmada', COMPLETED: 'Realizada', CANCELLED: 'Cancelada', NO_SHOW: 'Cliente não compareceu',
};
/** Visitas que ocupam a agenda do corretor. */
export const ACTIVE_VISIT_STATUSES: VisitStatus[] = ['SCHEDULED', 'CONFIRMED'];

// ---------- Propostas ----------
export const PROPOSAL_STATUSES = ['DRAFT', 'SENT', 'UNDER_REVIEW', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: 'Rascunho', SENT: 'Enviada ao proprietário', UNDER_REVIEW: 'Em análise', COUNTERED: 'Contraproposta', ACCEPTED: 'Aceita', REJECTED: 'Recusada', EXPIRED: 'Expirada', CANCELLED: 'Cancelada',
};
export const OPEN_PROPOSAL_STATUSES: ProposalStatus[] = ['DRAFT', 'SENT', 'UNDER_REVIEW', 'COUNTERED'];
export const PROPOSAL_PARTIES = ['BUYER', 'OWNER'] as const;
export type ProposalParty = (typeof PROPOSAL_PARTIES)[number];
export const PARTY_LABELS: Record<ProposalParty, string> = { BUYER: 'Comprador', OWNER: 'Proprietário' };

/** Quem pode ir para onde. Estados finais (recusada, expirada, cancelada) não voltam. */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['UNDER_REVIEW', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  UNDER_REVIEW: ['COUNTERED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  COUNTERED: ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['CANCELLED'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/** Papéis fixos das etapas do funil: a automação os usa, então continua funcionando se as etapas forem renomeadas. */
export const STAGE_SYSTEM_KEYS = ['VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL', 'NEGOTIATION', 'WON'] as const;
export type StageSystemKey = (typeof STAGE_SYSTEM_KEYS)[number];

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const price = z.number().positive('Informe um valor maior que zero').max(999_999_999_999);
const optMoney = z.number().min(0).max(999_999_999_999).optional().nullable();

// Defaults só na criação: `.partial()` os reaplicaria em toda edição (ver a lição do bloco 5).
const visitBase = z.object({
  leadId: uuid,
  propertyId: uuid.optional().nullable(),
  brokerId: uuid.optional().nullable(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480),
  notes: text(2000),
  /** Agendar mesmo havendo conflito de horário do corretor. */
  force: z.boolean().optional(),
});
export const createVisitSchema = visitBase.extend({ durationMinutes: z.number().int().min(15).max(480).default(60) });
export const updateVisitSchema = visitBase.omit({ leadId: true }).partial().extend({
  status: z.enum(VISIT_STATUSES).optional(),
  feedback: text(4000),
  cancelReason: text(300),
});
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;

export const listVisitsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  brokerId: z.union([uuid, z.literal('me')]).optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  leadId: uuid.optional(),
  propertyId: uuid.optional(),
});

export const createProposalSchema = z.object({
  leadId: uuid,
  propertyId: uuid.optional().nullable(),
  proposedPrice: price,
  downPayment: optMoney,
  financingAmount: optMoney,
  conditions: text(4000),
  validUntil: z.string().datetime().optional().nullable(),
  /** true = já enviada ao proprietário; false = rascunho. */
  send: z.boolean().default(true),
});
export const updateProposalSchema = z.object({
  downPayment: optMoney,
  financingAmount: optMoney,
  conditions: text(4000),
  validUntil: z.string().datetime().optional().nullable(),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  statusNote: text(300),
});
export const counterProposalSchema = z.object({
  amount: price,
  conditions: text(4000),
  party: z.enum(PROPOSAL_PARTIES),
  note: text(500),
});
export const listProposalsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PROPOSAL_STATUSES).optional(),
  open: z.enum(['true']).optional(),
  leadId: uuid.optional(),
  propertyId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
});
export type CreateProposalInput = z.infer<typeof createProposalSchema>;
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>;
export type CounterProposalInput = z.infer<typeof counterProposalSchema>;
