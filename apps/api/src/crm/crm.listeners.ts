import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LEAD_SOURCE_LABELS } from '@imob/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CrmEvents, type LeadAssignedEvent, type LeadCreatedEvent, type LeadStageChangedEvent, type LeadUpdatedEvent, type TaskEvent,
} from './crm.events';
import { TasksService } from './tasks.service';

/** Timeline: cada evento do CRM vira uma linha no histórico do lead. */
@Injectable()
export class TimelineListener {
  constructor(private readonly prisma: PrismaService) {}

  private add(e: { companyId: string; leadId: string; userId: string | null }, type: string, title: string, description?: string | null, extra?: { entityId?: string; metadata?: object }) {
    return this.prisma.timelineEvent.create({
      data: { companyId: e.companyId, leadId: e.leadId, userId: e.userId, type, title, description: description ?? null, entityId: extra?.entityId, metadata: extra?.metadata as never },
    });
  }

  @OnEvent(CrmEvents.LeadCreated)
  created(e: LeadCreatedEvent) {
    const origem = LEAD_SOURCE_LABELS[e.source as keyof typeof LEAD_SOURCE_LABELS] ?? e.source;
    return this.add(e, 'LEAD_CREATED', 'Lead criado', `Origem: ${origem}${e.propertyCode ? ` · Imóvel ${e.propertyCode}` : ''}`, { metadata: { source: e.source, propertyId: e.propertyId } });
  }

  @OnEvent(CrmEvents.LeadStageChanged)
  stage(e: LeadStageChangedEvent) {
    return this.add(e, 'STAGE_CHANGED', `Movido para “${e.toName}”`, e.lostReason ? `Motivo: ${e.lostReason}` : e.fromName ? `De “${e.fromName}”` : null, { metadata: { from: e.fromStageId, to: e.toStageId } });
  }

  @OnEvent(CrmEvents.LeadAssigned)
  assigned(e: LeadAssignedEvent) {
    return this.add(e, 'LEAD_ASSIGNED', e.toBrokerName ? `Atribuído a ${e.toBrokerName}` : 'Responsável removido', e.auto ? 'Distribuição automática (rodízio)' : null, { metadata: { from: e.fromBrokerId, to: e.toBrokerId } });
  }

  @OnEvent(CrmEvents.LeadUpdated)
  updated(e: LeadUpdatedEvent) {
    return this.add(e, 'LEAD_UPDATED', 'Dados do lead atualizados', null, { metadata: { fields: e.fields } });
  }

  @OnEvent(CrmEvents.TaskCreated)
  taskCreated(e: TaskEvent) { return this.add(e, 'TASK_CREATED', 'Tarefa criada', e.title, { entityId: e.taskId }); }

  @OnEvent(CrmEvents.TaskCompleted)
  taskDone(e: TaskEvent) { return this.add(e, 'TASK_COMPLETED', 'Tarefa concluída', e.title, { entityId: e.taskId }); }
}

/** Automações simples do funil. */
@Injectable()
export class CrmAutomationListener {
  private readonly log = new Logger('CrmAutomation');
  constructor(private readonly prisma: PrismaService, private readonly tasks: TasksService) {}

  /** Todo lead novo com responsável ganha uma tarefa de primeiro contato (prazo de 30 minutos). */
  @OnEvent(CrmEvents.LeadCreated)
  async firstContact(e: LeadCreatedEvent) {
    if (!e.brokerId) return;
    await this.tasks.createSystem({
      companyId: e.companyId, leadId: e.leadId, assignedUserId: e.brokerId, title: 'Fazer o primeiro contato',
      type: 'CALL', priority: 'HIGH', dueAt: new Date(Date.now() + 30 * 60_000),
    });
  }

  /** Ao trocar o responsável, as tarefas em aberto do antigo passam para o novo. */
  @OnEvent(CrmEvents.LeadAssigned)
  async reassign(e: LeadAssignedEvent) {
    if (!e.toBrokerId) return;
    const r = await this.prisma.task.updateMany({
      where: { leadId: e.leadId, status: 'OPEN', assignedUserId: e.fromBrokerId },
      data: { assignedUserId: e.toBrokerId },
    });
    if (r.count) this.log.debug(`${r.count} tarefa(s) repassada(s) no lead ${e.leadId}`);
  }
}
