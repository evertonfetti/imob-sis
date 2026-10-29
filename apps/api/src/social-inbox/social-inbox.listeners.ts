import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CONVERSATION_CHANNEL_LABELS } from '@imob/types';
import { PrismaService } from '../prisma/prisma.service';
import { SocialInboxEvents, type SocialInboxEvent } from './social-inbox.events';

/** Timeline do lead: registra o início de cada conversa pelo Messenger/Instagram (mesmo padrão do WhatsApp). */
@Injectable()
export class SocialInboxTimelineListener {
  constructor(private readonly prisma: PrismaService) {}

  private add(e: SocialInboxEvent, type: string, title: string) {
    return this.prisma.timelineEvent.create({
      data: { companyId: e.companyId, leadId: e.leadId, userId: e.userId, type, title, description: e.preview, entityId: e.conversationId },
    });
  }

  @OnEvent(SocialInboxEvents.Received)
  async received(e: SocialInboxEvent) { if (e.sessionStart) await this.add(e, 'SOCIAL_RECEIVED', `Mensagem recebida no ${CONVERSATION_CHANNEL_LABELS[e.channel]}`); }

  @OnEvent(SocialInboxEvents.Sent)
  async sent(e: SocialInboxEvent) { if (e.sessionStart) await this.add(e, 'SOCIAL_SENT', `Mensagem enviada pelo ${CONVERSATION_CHANNEL_LABELS[e.channel]}`); }
}
