import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappEvents, type WhatsappEvent } from './whatsapp.events';

/** Timeline do lead: registra o início de cada conversa (não cada mensagem, para não poluir o histórico). */
@Injectable()
export class WhatsappTimelineListener {
  constructor(private readonly prisma: PrismaService) {}

  private add(e: WhatsappEvent, type: string, title: string) {
    return this.prisma.timelineEvent.create({
      data: { companyId: e.companyId, leadId: e.leadId, userId: e.userId, type, title, description: e.preview, entityId: e.conversationId },
    });
  }

  @OnEvent(WhatsappEvents.Received)
  async received(e: WhatsappEvent) { if (e.sessionStart) await this.add(e, 'WHATSAPP_RECEIVED', 'Mensagem recebida no WhatsApp'); }

  @OnEvent(WhatsappEvents.Sent)
  async sent(e: WhatsappEvent) { if (e.sessionStart) await this.add(e, 'WHATSAPP_SENT', 'Mensagem enviada pelo WhatsApp'); }
}
