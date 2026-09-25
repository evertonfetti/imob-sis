import { z } from 'zod';
import { LEAD_SOURCES } from './public';
import { PROPERTY_PURPOSES } from './property';

// ---------- Funil ----------
export const STAGE_TYPES = ['OPEN', 'WON', 'LOST'] as const;
export type StageType = (typeof STAGE_TYPES)[number];

/** Estágios iniciais (spec §28). `qualifies`: entrar aqui dispara o evento lead.qualified. */
export const DEFAULT_STAGES: { name: string; color: string; type: StageType; qualifies?: boolean }[] = [
  { name: 'Novo', color: '#8a8578', type: 'OPEN' },
  { name: 'Contato iniciado', color: '#7f8fa0', type: 'OPEN' },
  { name: 'Contato realizado', color: '#6f8f8a', type: 'OPEN' },
  { name: 'Qualificado', color: '#4f7a6a', type: 'OPEN', qualifies: true },
  { name: 'Imóveis apresentados', color: '#8c8a5a', type: 'OPEN' },
  { name: 'Visita agendada', color: '#a7864d', type: 'OPEN' },
  { name: 'Visita realizada', color: '#b07a4a', type: 'OPEN' },
  { name: 'Proposta', color: '#9a6a5a', type: 'OPEN' },
  { name: 'Negociação', color: '#8a5a6a', type: 'OPEN' },
  { name: 'Fechado', color: '#3f6b52', type: 'WON' },
  { name: 'Perdido', color: '#9b3f2e', type: 'LOST' },
];

export const LEAD_DISTRIBUTIONS = ['MANUAL', 'ROUND_ROBIN'] as const;
export type LeadDistribution = (typeof LEAD_DISTRIBUTIONS)[number];
export const DISTRIBUTION_LABELS: Record<LeadDistribution, string> = {
  MANUAL: 'Manual (a equipe distribui)',
  ROUND_ROBIN: 'Rodízio entre corretores',
};

// ---------- Tarefas ----------
export const TASK_TYPES = ['CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'FOLLOW_UP', 'OTHER'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CALL: 'Ligação', WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', VISIT: 'Visita', FOLLOW_UP: 'Retorno', OTHER: 'Outra',
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' };

// ---------- Timeline ----------
export const TIMELINE_TYPES = [
  'LEAD_CREATED', 'STAGE_CHANGED', 'LEAD_ASSIGNED', 'LEAD_UPDATED', 'NOTE_ADDED', 'TASK_CREATED', 'TASK_COMPLETED',
  // reservados para blocos futuros
  'WHATSAPP_RECEIVED', 'WHATSAPP_SENT', 'VISIT_CREATED', 'VISIT_COMPLETED', 'PROPOSAL_CREATED', 'PROPOSAL_UPDATED',
] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

// ---------- Schemas ----------
const uuid = z.string().uuid();
const optText = (max = 200) => z.string().trim().max(max).optional().nullable();
const money = z.number().min(0).max(999_999_999_999).optional().nullable();

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  phone: z.string().trim().max(30).optional().nullable().or(z.literal('')),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160).optional().nullable().or(z.literal('')),
  document: optText(30),
  notes: optText(2000),
});
export const updateCustomerSchema = customerSchema.partial();
export type CustomerInput = z.infer<typeof customerSchema>;

export const createLeadSchema = z
  .object({
    customerId: uuid.optional(),
    customer: customerSchema.optional(),
    propertyId: uuid.optional().nullable(),
    brokerId: uuid.optional().nullable(),
    stageId: uuid.optional(),
    source: z.enum(LEAD_SOURCES).default('MANUAL'),
    notes: optText(2000),
    budgetMin: money,
    budgetMax: money,
    purpose: z.enum(PROPERTY_PURPOSES).optional().nullable(),
    city: optText(100),
    neighborhood: optText(100),
    bedrooms: z.number().int().min(0).max(20).optional().nullable(),
    purchaseTimeline: optText(100),
  })
  .refine((v) => !!v.customerId !== !!v.customer, { message: 'Informe um cliente existente ou os dados de um novo cliente', path: ['customer'] });
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  propertyId: uuid.optional().nullable(),
  source: z.enum(LEAD_SOURCES).optional(),
  notes: optText(2000),
  budgetMin: money,
  budgetMax: money,
  purpose: z.enum(PROPERTY_PURPOSES).optional().nullable(),
  city: optText(100),
  neighborhood: optText(100),
  bedrooms: z.number().int().min(0).max(20).optional().nullable(),
  purchaseTimeline: optText(100),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/** brokerId nulo remove o responsável; `auto: true` usa a distribuição configurada (rodízio). */
export const assignLeadSchema = z.object({ brokerId: uuid.nullable().optional(), auto: z.boolean().optional() });
export const changeStageSchema = z.object({ stageId: uuid, lostReason: z.string().trim().max(300).optional().nullable() });
export const noteSchema = z.object({ text: z.string().trim().min(1, 'Escreva a anotação').max(4000) });
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const updateStageSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use o formato #RRGGBB').optional(),
});

export const listLeadsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  stageId: uuid.optional(),
  brokerId: z.union([uuid, z.literal('none')]).optional(),
  propertyId: uuid.optional(),
  customerId: uuid.optional(),
});
export type ListLeadsQuery = z.infer<typeof listLeadsSchema>;

export const boardQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  brokerId: z.union([uuid, z.literal('none')]).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  propertyId: uuid.optional(),
});

// Defaults só na criação: `.partial()` os reaplicaria em toda edição e sobrescreveria tipo/prioridade salvos.
const taskBase = z.object({
  title: z.string().trim().min(2, 'Informe o título').max(160),
  description: optText(2000),
  type: z.enum(TASK_TYPES),
  priority: z.enum(TASK_PRIORITIES),
  dueAt: z.string().datetime().optional().nullable(),
  leadId: uuid.optional().nullable(),
  propertyId: uuid.optional().nullable(),
  assignedUserId: uuid.optional().nullable(),
});
export const createTaskSchema = taskBase.extend({ type: z.enum(TASK_TYPES).default('FOLLOW_UP'), priority: z.enum(TASK_PRIORITIES).default('MEDIUM') });
export const updateTaskSchema = taskBase.partial().omit({ leadId: true });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const listTasksSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  view: z.enum(['open', 'overdue', 'today', 'done']).default('open'),
  assignedUserId: z.union([uuid, z.literal('me')]).optional(),
  leadId: uuid.optional(),
  // Limites do "hoje" no fuso do usuário (o servidor não sabe em que fuso o navegador está).
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ---------- Formato das respostas ----------
export interface StageDto { id: string; name: string; position: number; color: string; type: StageType; qualifies: boolean }
export interface BoardCard {
  id: string;
  customer: { id: string; name: string; phone: string | null };
  property: { id: string; code: string; title: string } | null;
  broker: { id: string; name: string } | null;
  source: string;
  stageEnteredAt: string;
  createdAt: string;
  overdueTasks: number;
}
export interface BoardColumn { stage: StageDto; total: number; leads: BoardCard[] }
