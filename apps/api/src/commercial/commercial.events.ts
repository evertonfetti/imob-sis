export const CommercialEvents = {
  VisitScheduled: 'visit.scheduled',
  VisitRescheduled: 'visit.rescheduled',
  VisitCompleted: 'visit.completed',
  VisitCancelled: 'visit.cancelled',
  ProposalCreated: 'proposal.created',
  ProposalUpdated: 'proposal.updated',
  ProposalAccepted: 'proposal.accepted',
} as const;

interface Base { companyId: string; leadId: string; userId: string | null }

export interface VisitEvent extends Base {
  visitId: string;
  brokerId: string;
  brokerName: string | null;
  scheduledAt: Date;
  propertyCode: string;
  /** CANCELLED ou NO_SHOW nos eventos de cancelamento. */
  kind?: 'CANCELLED' | 'NO_SHOW';
}

export interface ProposalEvent extends Base {
  proposalId: string;
  title: string;
  description?: string | null;
  status: string;
  amount: number;
  /** true quando a proposta passou a valer perante o proprietário (enviada / contraproposta / aceita). */
  advance?: 'PROPOSAL' | 'NEGOTIATION';
}
