import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MATCH_AUTO_TASK_SCORE } from '@imob/types';
import { CrmEvents, type LeadCreatedEvent, type LeadStageChangedEvent, type LeadUpdatedEvent } from '../crm/crm.events';
import { TasksService } from '../crm/tasks.service';
import { CommercialEvents, type ProposalEvent, type VisitEvent } from '../commercial/commercial.events';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappEvents, type WhatsappEvent } from '../whatsapp/whatsapp.events';
import { PropertyEvents, type PropertyPublishedEvent } from './intelligence.events';
import { LeadScoreService } from './lead-score.service';
import { MatchingService } from './matching.service';

const HOUR = 3_600_000;

/** Transforma dados em ação: recalcula o score, avisa quando o lead esquenta, sugere imóveis novos e encerra follow-ups de leads fechados. */
@Injectable()
export class IntelligenceListener {
  private readonly log = new Logger('Intelligence');
  constructor(private readonly prisma: PrismaService, private readonly score: LeadScoreService, private readonly matching: MatchingService, private readonly tasks: TasksService) {}

  private async safe(what: string, fn: () => Promise<unknown>) {
    try { await fn(); } catch (e) { this.log.error(`${what}: ${(e as Error).message}`); } // a inteligência nunca derruba a operação principal
  }

  // ---------- Score ----------
  @OnEvent(CrmEvents.LeadCreated) onCreated(e: LeadCreatedEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CrmEvents.LeadUpdated) onUpdated(e: LeadUpdatedEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(WhatsappEvents.Received) onWhatsapp(e: WhatsappEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.VisitScheduled) onVisit1(e: VisitEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.VisitRescheduled) onVisit2(e: VisitEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.VisitCompleted) onVisit3(e: VisitEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.VisitCancelled) onVisit4(e: VisitEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.ProposalCreated) onProp1(e: ProposalEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.ProposalUpdated) onProp2(e: ProposalEvent) { return this.rescore(e.companyId, e.leadId); }
  @OnEvent(CommercialEvents.ProposalAccepted) onProp3(e: ProposalEvent) { return this.rescore(e.companyId, e.leadId); }

  private rescore(companyId: string, leadId: string) {
    return this.safe(`score do lead ${leadId}`, async () => {
      const r = await this.score.recompute(companyId, leadId);
      if (!r?.crossedHot) return;
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { status: true, brokerId: true, customer: { select: { name: true } } } });
      if (!lead || lead.status === 'WON' || lead.status === 'LOST') return;
      const task = await this.tasks.createSystemOnce({
        companyId, leadId, assignedUserId: lead.brokerId, title: `Lead quente: priorize o contato com ${lead.customer.name}`, type: 'FOLLOW_UP', priority: 'HIGH', dueAt: new Date(Date.now() + 2 * HOUR), ref: `hot:${leadId}`,
      });
      if (task) await this.prisma.timelineEvent.create({ data: { companyId, leadId, userId: null, type: 'SCORE_HOT', title: 'Lead ficou quente', description: `Score ${r.after}: interesse crescente, hora de priorizar.` } });
    });
  }

  // ---------- Novo imóvel publicado → sugere aos leads compatíveis ----------
  @OnEvent(PropertyEvents.Published)
  onPublished(e: PropertyPublishedEvent) {
    return this.safe(`matching do imóvel ${e.propertyId}`, async () => {
      const prop = await this.prisma.property.findFirst({ where: { id: e.propertyId, companyId: e.companyId, status: 'AVAILABLE' }, select: { code: true } });
      if (!prop) return;
      const { items } = await this.matching.matchPropertyToLeads(e.companyId, e.propertyId, { minScore: MATCH_AUTO_TASK_SCORE, limit: 15 });
      for (const m of items) {
        const lead = await this.prisma.lead.findUnique({ where: { id: m.leadId }, select: { brokerId: true } });
        if (!lead?.brokerId) continue; // sem responsável não há a quem entregar a tarefa
        const task = await this.tasks.createSystemOnce({
          companyId: e.companyId, leadId: m.leadId, assignedUserId: lead.brokerId, title: `Apresentar ${prop.code} a ${m.lead.customerName} (${m.score}% compatível)`, type: 'FOLLOW_UP', priority: 'MEDIUM', dueAt: new Date(Date.now() + 24 * HOUR), ref: `match:${m.leadId}:${e.propertyId}`,
        });
        if (task) await this.prisma.timelineEvent.create({ data: { companyId: e.companyId, leadId: m.leadId, userId: null, type: 'PROPERTY_MATCH', title: `Novo imóvel compatível: ${prop.code}`, description: m.reasons.slice(0, 3).join(' · '), entityId: e.propertyId } });
      }
    });
  }

  // ---------- Lead encerrado → encerra follow-ups automáticos ----------
  @OnEvent(CrmEvents.LeadStageChanged)
  onStage(e: LeadStageChangedEvent) {
    if (e.toType !== 'WON' && e.toType !== 'LOST') return;
    return this.safe(`follow-ups do lead ${e.leadId}`, () => this.prisma.task.updateMany({ where: { leadId: e.leadId, status: 'OPEN', createdById: null }, data: { status: 'CANCELLED' } }));
  }
}
