import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { MetaEvent } from '@imob/types';
import { CrmEvents, type LeadCreatedEvent, type LeadStageChangedEvent } from '../crm/crm.events';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingEvents, type WhatsappClickedEvent } from './marketing.events';
import { MarketingService } from './marketing.service';

/** Transforma eventos do sistema em conversões para a Meta, sem que o CRM precise conhecer o Marketing. */
@Injectable()
export class MarketingListener {
  constructor(private readonly marketing: MarketingService, private readonly prisma: PrismaService) {}

  /** Lead vindo do formulário do site → evento "Lead" (mesmo event_id do Pixel, para deduplicar). */
  @OnEvent(CrmEvents.LeadCreated)
  async leadCreated(e: LeadCreatedEvent) {
    if (e.source === 'SITE') await this.marketing.track({ companyId: e.companyId, leadId: e.leadId, eventName: 'Lead' });
  }

  /** Entrar numa etapa mapeada (Marketing → Conversões) dispara o evento configurado para ela. */
  @OnEvent(CrmEvents.LeadStageChanged)
  async stageChanged(e: LeadStageChangedEvent) {
    const stage = await this.prisma.pipelineStage.findUnique({ where: { id: e.toStageId }, select: { metaEvent: true } });
    if (stage?.metaEvent) await this.marketing.track({ companyId: e.companyId, leadId: e.leadId, eventName: stage.metaEvent as MetaEvent });
  }

  @OnEvent(MarketingEvents.WhatsappClicked)
  async whatsappClicked(e: WhatsappClickedEvent) {
    await this.marketing.track({ companyId: e.companyId, clickId: e.clickId, eventName: 'Contact' });
  }
}
