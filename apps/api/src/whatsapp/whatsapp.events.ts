export const WhatsappEvents = { Received: 'whatsapp.received', Sent: 'whatsapp.sent' } as const;

export interface WhatsappEvent {
  companyId: string;
  leadId: string;
  userId: string | null;
  conversationId: string;
  preview: string;
  /** Primeira mensagem de uma sequência (a timeline registra o início da conversa, não cada mensagem). */
  sessionStart: boolean;
}
