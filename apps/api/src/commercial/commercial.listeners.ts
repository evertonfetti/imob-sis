import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LeadsService } from '../crm/leads.service';
import { TasksService } from '../crm/tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommercialEvents, type ProposalEvent, type VisitEvent } from './commercial.events';

const HOUR = 3_600_000;
const fmt = (d: Date) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Timeline do lead + automação do funil e das tarefas a partir de visitas e propostas. */
@Injectable()
export class CommercialListener {
  constructor(private readonly prisma: PrismaService, private readonly leads: LeadsService, private readonly tasks: TasksService) {}

  private add(e: { companyId: string; leadId: string; userId: string | null }, type: string, title: string, description?: string | null, entityId?: string) {
    return this.prisma.timelineEvent.create({ data: { companyId: e.companyId, leadId: e.leadId, userId: e.userId, type, title, description: description ?? null, entityId } });
  }

  // ---------- Visitas ----------
  @OnEvent(CommercialEvents.VisitScheduled)
  async scheduled(e: VisitEvent) {
    await this.add(e, 'VISIT_CREATED', 'Visita agendada', `${fmt(e.scheduledAt)} · ${e.propertyCode}${e.brokerName ? ` · com ${e.brokerName}` : ''}`, e.visitId);
    await this.leads.advanceTo(e.companyId, e.leadId, 'VISIT_SCHEDULED', e.userId);
    await this.confirmTask(e);
  }

  @OnEvent(CommercialEvents.VisitRescheduled)
  async rescheduled(e: VisitEvent) {
    await this.add(e, 'VISIT_CREATED', 'Visita reagendada', `${fmt(e.scheduledAt)} · ${e.propertyCode}${e.brokerName ? ` · com ${e.brokerName}` : ''}`, e.visitId);
    await this.tasks.cancelByRef(e.companyId, `visit:${e.visitId}:confirm`);
    await this.confirmTask(e);
  }

  /** Lembrete para confirmar a visita com o cliente (24h antes; ou logo, se falta pouco). */
  private async confirmTask(e: VisitEvent) {
    if (e.scheduledAt.getTime() < Date.now() + HOUR) return;
    await this.tasks.createSystem({
      companyId: e.companyId, leadId: e.leadId, assignedUserId: e.brokerId, title: `Confirmar a visita de ${fmt(e.scheduledAt)} com o cliente`,
      type: 'VISIT', priority: 'MEDIUM', dueAt: new Date(Math.max(Date.now() + 30 * 60_000, e.scheduledAt.getTime() - 24 * HOUR)), ref: `visit:${e.visitId}:confirm`,
    });
  }

  @OnEvent(CommercialEvents.VisitCompleted)
  async completed(e: VisitEvent) {
    await this.add(e, 'VISIT_COMPLETED', 'Visita realizada', `${e.propertyCode}${e.brokerName ? ` · com ${e.brokerName}` : ''}`, e.visitId);
    await this.leads.advanceTo(e.companyId, e.leadId, 'VISIT_DONE', e.userId);
    await this.tasks.cancelByRef(e.companyId, `visit:${e.visitId}:confirm`);
    await this.tasks.createSystem({
      companyId: e.companyId, leadId: e.leadId, assignedUserId: e.brokerId, title: 'Ligar para o cliente e combinar os próximos passos após a visita',
      type: 'FOLLOW_UP', priority: 'HIGH', dueAt: new Date(Date.now() + 24 * HOUR), ref: `visit:${e.visitId}:followup`,
    });
  }

  @OnEvent(CommercialEvents.VisitCancelled)
  async cancelled(e: VisitEvent) {
    const noShow = e.kind === 'NO_SHOW';
    await this.add(e, 'VISIT_CANCELLED', noShow ? 'Cliente não compareceu à visita' : 'Visita cancelada', `${fmt(e.scheduledAt)} · ${e.propertyCode}`, e.visitId);
    await this.tasks.cancelByRef(e.companyId, `visit:${e.visitId}:confirm`);
    await this.tasks.createSystem({
      companyId: e.companyId, leadId: e.leadId, assignedUserId: e.brokerId, title: noShow ? 'Entrar em contato e reagendar a visita (cliente faltou)' : 'Oferecer um novo horário de visita',
      type: 'CALL', priority: 'MEDIUM', dueAt: new Date(Date.now() + 24 * HOUR), ref: `visit:${e.visitId}:reschedule`,
    });
  }

  // ---------- Propostas ----------
  @OnEvent(CommercialEvents.ProposalCreated)
  async proposalCreated(e: ProposalEvent) {
    await this.add(e, 'PROPOSAL_CREATED', e.title, e.description, e.proposalId);
    if (e.advance) await this.leads.advanceTo(e.companyId, e.leadId, e.advance, e.userId);
  }

  @OnEvent(CommercialEvents.ProposalUpdated)
  async proposalUpdated(e: ProposalEvent) {
    await this.add(e, 'PROPOSAL_UPDATED', e.title, e.description, e.proposalId);
    if (e.advance) await this.leads.advanceTo(e.companyId, e.leadId, e.advance, e.userId);
  }

  @OnEvent(CommercialEvents.ProposalAccepted)
  async proposalAccepted(e: ProposalEvent) {
    await this.add(e, 'PROPOSAL_UPDATED', e.title, e.description, e.proposalId);
    if (e.advance) await this.leads.advanceTo(e.companyId, e.leadId, e.advance, e.userId);
  }
}
