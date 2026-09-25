import { z } from 'zod';

export const LEAD_SOURCES = ['SITE', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'PORTAL', 'REFERRAL', 'PHONE', 'MANUAL'] as const;
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  SITE: 'Site', WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', GOOGLE: 'Google',
  PORTAL: 'Portal', REFERRAL: 'Indicação', PHONE: 'Telefone', MANUAL: 'Manual',
};
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Novo', CONTACTED: 'Em contato', QUALIFIED: 'Qualificado', WON: 'Fechado', LOST: 'Perdido',
};

// ---------- Busca pública ----------
export const PUBLIC_SORTS = ['recent', 'price_asc', 'price_desc'] as const;

const optNum = z.coerce.number().min(0).optional();
export const publicListSchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
  purpose: z.enum(['SALE', 'RENT']).optional(),
  type: z.string().trim().max(80).optional(),
  city: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().max(100).optional(),
  priceMin: optNum,
  priceMax: optNum,
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  suites: z.coerce.number().int().min(0).max(20).optional(),
  parkingSpaces: z.coerce.number().int().min(0).max(20).optional(),
  areaMin: optNum,
  areaMax: optNum,
  features: z.string().trim().max(400).optional(), // slugs separados por vírgula: o imóvel precisa ter todos
  featured: z.enum(['true']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(PUBLIC_SORTS).default('recent'),
});
export type PublicListQuery = z.infer<typeof publicListSchema>;

// ---------- Formulário de interesse ----------
const attr = z.string().trim().max(500).optional().nullable();

export const publicLeadSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => {
      const d = v.replace(/\D/g, '');
      return d.length >= 10 && d.length <= 13;
    }, 'Informe um telefone com DDD'),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(160).optional().nullable().or(z.literal('')),
  message: z.string().trim().max(2000).optional().nullable(),
  propertyId: z.string().uuid().optional().nullable(),
  consent: z.literal(true, { message: 'É necessário concordar com o contato' }),
  // Campo-isca contra robôs: humanos não veem nem preenchem.
  website: z.string().max(200).optional(),

  utmSource: attr, utmMedium: attr, utmCampaign: attr, utmContent: attr, utmTerm: attr,
  fbclid: attr, fbc: attr, fbp: attr, gclid: attr,
  landingPage: attr, referrer: attr,
  campaignId: attr, adsetId: attr, adId: attr,
  // Mesmo ID do evento do Pixel no navegador: a Meta junta Pixel + CAPI em um só (deduplicação).
  eventId: z.string().trim().max(80).optional().nullable(),
  pageUrl: attr,
  marketingConsent: z.boolean().optional(),
});
export type PublicLeadInput = z.infer<typeof publicLeadSchema>;

export const whatsappClickSchema = z.object({
  propertyId: z.string().uuid().optional().nullable(),
  sessionId: z.string().max(80).optional().nullable(),
  visitorId: z.string().max(80).optional().nullable(),
  utmSource: attr, utmMedium: attr, utmCampaign: attr, utmContent: attr, utmTerm: attr,
  fbclid: attr, fbc: attr, fbp: attr, gclid: attr,
  landingPage: attr, referrer: attr,
  eventId: z.string().trim().max(80).optional().nullable(),
  pageUrl: attr,
  marketingConsent: z.boolean().optional(),
});
export type WhatsappClickInput = z.infer<typeof whatsappClickSchema>;

// ---------- Formato das respostas públicas ----------
export interface PublicCompany {
  name: string;
  tradeName: string | null;
  creci: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  address: string | null;
  metaPixelId: string | null;
}

export interface PublicPropertyCard {
  id: string;
  code: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  purpose: 'SALE' | 'RENT' | 'SALE_AND_RENT';
  status: string;
  type: string;
  subtype: string | null;
  salePrice: number | null;
  rentPrice: number | null;
  condominiumFee: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  totalArea: number | null;
  usefulArea: number | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  featured: boolean;
  coverUrl: string | null;
  coverFullUrl: string | null;
  publishedAt: string | null;
}

export interface PublicMedia {
  id: string;
  type: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  url: string;
  thumbnailUrl: string | null;
}

export interface PublicPropertyDetail extends PublicPropertyCard {
  description: string | null;
  propertyTax: number | null;
  builtArea: number | null;
  landArea: number | null;
  address: string | null;
  number: string | null;
  complement: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  showExactAddress: boolean;
  updatedAt: string;
  features: { id: string; name: string; category: string | null }[];
  media: PublicMedia[];
  broker: { name: string; creci: string | null } | null;
  similar: PublicPropertyCard[];
}
