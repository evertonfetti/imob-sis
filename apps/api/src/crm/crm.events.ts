/** Eventos internos do CRM (spec §56). Quem reage (timeline, automações, marketing) não é conhecido por quem emite. */
export const CrmEvents = {
  LeadCreated: 'lead.created',
  LeadAssigned: 'lead.assigned',
  LeadStageChanged: 'lead.stage_changed',
  LeadQualified: 'lead.qualified',
  LeadUpdated: 'lead.updated',
  TaskCreated: 'task.created',
  TaskCompleted: 'task.completed',
} as const;

interface Base { companyId: string; leadId: string; userId: string | null }

export interface LeadCreatedEvent extends Base {
  source: string; propertyId: string | null; propertyCode: string | null; brokerId: string | null; stageName: string;
}
export interface LeadAssignedEvent extends Base { fromBrokerId: string | null; toBrokerId: string | null; toBrokerName: string | null; auto: boolean }
export interface LeadStageChangedEvent extends Base {
  fromStageId: string | null; toStageId: string; fromName: string | null; toName: string; toType: string; lostReason: string | null;
}
export interface LeadQualifiedEvent extends Base { stageId: string; stageName: string }
export interface LeadUpdatedEvent extends Base { fields: string[] }
export interface TaskEvent extends Base { taskId: string; title: string }
