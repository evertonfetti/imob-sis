import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsappEvents, type WhatsappEvent } from '../whatsapp/whatsapp.events';
import { AgentService } from './agent.service';

/** Cada mensagem recebida no WhatsApp aciona o agente (ele mesmo decide se deve responder). */
@Injectable()
export class AgentListener {
  private readonly log = new Logger('AgentListener');
  constructor(private readonly agent: AgentService) {}

  @OnEvent(WhatsappEvents.Received)
  async onReceived(e: WhatsappEvent) {
    try { await this.agent.schedule(e.companyId, e.conversationId); } catch (err) { this.log.error(`Agente: ${(err as Error).message}`); } // nunca derruba o recebimento da mensagem
  }
}
