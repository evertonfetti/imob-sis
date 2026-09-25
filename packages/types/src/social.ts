import { z } from 'zod';

export const SOCIAL_PROVIDERS = ['FACEBOOK_PAGE', 'INSTAGRAM'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export const SOCIAL_PROVIDER_LABELS: Record<SocialProvider, string> = { FACEBOOK_PAGE: 'Facebook', INSTAGRAM: 'Instagram' };

export const SOCIAL_POST_STATUSES = ['SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];
export const SOCIAL_POST_STATUS_LABELS: Record<SocialPostStatus, string> = {
  SCHEDULED: 'Agendada', PUBLISHING: 'Publicando', PUBLISHED: 'Publicada', PARTIAL: 'Publicada em parte', FAILED: 'Falhou', CANCELLED: 'Cancelada',
};

/** Limites da Meta. */
export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_CAROUSEL_MAX = 10;
export const SOCIAL_MAX_DAYS_AHEAD = 180;

export const activateAccountsSchema = z.object({ accountIds: z.array(z.string().uuid()).max(50) });

export const createSocialPostSchema = z.object({
  propertyId: z.string().uuid(),
  mediaIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma foto').max(INSTAGRAM_CAROUSEL_MAX, `No máximo ${INSTAGRAM_CAROUSEL_MAX} fotos`),
  caption: z.string().trim().min(1, 'Escreva o texto da publicação').max(20000),
  accountIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos uma conta').max(10),
  /** ISO 8601. Ausente = publicar agora. */
  scheduledAt: z.string().datetime().optional().nullable(),
});
export type CreateSocialPostInput = z.infer<typeof createSocialPostSchema>;

export const updateSocialPostSchema = createSocialPostSchema.omit({ propertyId: true }).partial();
export type UpdateSocialPostInput = z.infer<typeof updateSocialPostSchema>;

export const listSocialPostsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  view: z.enum(['scheduled', 'published', 'failed']).optional(),
  propertyId: z.string().uuid().optional(),
});

export interface SocialAccountDto {
  id: string;
  provider: SocialProvider;
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED';
  linkedPageName: string | null;
}

export interface SocialTargetDto {
  id: string;
  accountId: string;
  provider: SocialProvider;
  accountName: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  permalink: string | null;
  error: string | null;
  retryable: boolean;
  attempts: number;
  nextAttemptAt: string | null;
}

export interface SocialPostDto {
  id: string;
  propertyId: string;
  property: { id: string; code: string; title: string } | null;
  caption: string;
  status: SocialPostStatus;
  scheduledAt: string;
  publishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  media: { id: string; thumbnailUrl: string | null; url: string | null }[];
  targets: SocialTargetDto[];
}
