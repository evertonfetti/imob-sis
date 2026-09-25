import { z } from 'zod';

export const MEDIA_TYPES = ['IMAGE', 'VIDEO', 'FLOOR_PLAN', 'TOUR_360', 'DOCUMENT'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  IMAGE: 'Foto', VIDEO: 'Vídeo', FLOOR_PLAN: 'Planta', TOUR_360: 'Tour 360°', DOCUMENT: 'Documento',
};

const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** Tipos de arquivo aceitos por tipo de mídia. */
export const MEDIA_CONTENT_TYPES: Record<MediaType, string[]> = {
  IMAGE: IMAGES,
  TOUR_360: IMAGES,
  FLOOR_PLAN: [...IMAGES, 'application/pdf'],
  VIDEO: ['video/mp4', 'video/webm'],
  DOCUMENT: ['application/pdf'],
};

const MB = 1024 * 1024;
export const MEDIA_MAX_BYTES: Record<MediaType, number> = {
  IMAGE: 25 * MB, TOUR_360: 40 * MB, FLOOR_PLAN: 25 * MB, VIDEO: 300 * MB, DOCUMENT: 25 * MB,
};
export const MEDIA_MAX_PER_PROPERTY = 100;

export const isProcessableImage = (type: MediaType, contentType: string) =>
  (type === 'IMAGE' || type === 'TOUR_360' || type === 'FLOOR_PLAN') && contentType.startsWith('image/');

export const uploadUrlSchema = z.object({
  type: z.enum(MEDIA_TYPES).default('IMAGE'),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(3).max(100),
  size: z.number().int().positive(),
});
export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;

export const confirmMediaSchema = z.object({
  type: z.enum(MEDIA_TYPES).default('IMAGE'),
  key: z.string().min(10).max(300),
  contentType: z.string().trim().min(3).max(100),
  filename: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(200).optional().nullable(),
});
export type ConfirmMediaInput = z.infer<typeof confirmMediaSchema>;

export const orderMediaSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(MEDIA_MAX_PER_PROPERTY) });
export const updateMediaSchema = z.object({
  caption: z.string().trim().max(200).optional().nullable(),
  isCover: z.boolean().optional(),
});
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export interface MediaItem {
  id: string;
  propertyId: string;
  type: MediaType;
  filename: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  position: number;
  isCover: boolean;
  aiModified: boolean;
  /** Versão de IA aprovada (null = original) e a que já está renderizada na foto publicada. */
  activeGenerationId: string | null;
  renderedGenerationId: string | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  processingError: string | null;
  originalUrl: string;
  processedUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}
