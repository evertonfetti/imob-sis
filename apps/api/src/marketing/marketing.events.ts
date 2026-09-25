export const MarketingEvents = { WhatsappClicked: 'whatsapp.clicked' } as const;

export interface WhatsappClickedEvent { companyId: string; clickId: string }
