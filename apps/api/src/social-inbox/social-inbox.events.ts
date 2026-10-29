export const SocialInboxEvents = { Received: 'social-inbox.received', Sent: 'social-inbox.sent' } as const;

/** Mesmo formato do WhatsappEvent: o AgentListener escuta os dois para acionar o agente de IA. */
export interface SocialInboxEvent {
  companyId: string;
  channel: 'FACEBOOK' | 'INSTAGRAM';
  leadId: string;
  userId: string | null;
  conversationId: string;
  preview: string;
  /** Primeira mensagem de uma sequência (a timeline registra o início da conversa, não cada mensagem). */
  sessionStart: boolean;
}
