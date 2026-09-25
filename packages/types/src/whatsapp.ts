import { z } from 'zod';

export const MESSAGE_STATUSES = ['RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const integrationSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, 'O ID do número tem apenas dígitos').optional(),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, 'O ID da conta tem apenas dígitos').optional().nullable().or(z.literal('')),
  accessToken: z.string().trim().min(20, 'Token muito curto').max(1000).optional(),
  appSecret: z.string().trim().min(16, 'Segredo do app muito curto').max(200).optional(),
});
export type IntegrationInput = z.infer<typeof integrationSchema>;

export const sendMessageSchema = z
  .object({
    text: z.string().trim().min(1, 'Escreva a mensagem').max(4096).optional(),
    template: z
      .object({
        name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Nome do modelo: minúsculas, números e _'),
        language: z.string().trim().min(2).max(10).default('pt_BR'),
        params: z.array(z.string().trim().min(1).max(1024)).max(10).optional(),
      })
      .optional(),
  })
  .refine((v) => !!v.text !== !!v.template, { message: 'Envie um texto ou um modelo aprovado', path: ['text'] });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(100).optional(),
  unread: z.enum(['true']).optional(),
  leadId: z.string().uuid().optional(),
});

export interface MessageDto {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: string | null;
  hasMedia: boolean;
  mediaMime: string | null;
  mediaUrl: string | null;
  status: MessageStatus;
  error: string | null;
  sentBy: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ConversationDto {
  id: string;
  contactName: string | null;
  phone: string;
  status: 'OPEN' | 'CLOSED';
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  windowOpen: boolean;
  windowClosesAt: string | null;
  lead: {
    id: string;
    stage: { name: string; color: string } | null;
    broker: { id: string; name: string } | null;
    property: { id: string; code: string } | null;
  } | null;
}
