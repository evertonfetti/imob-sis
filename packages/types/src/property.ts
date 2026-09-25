import { z } from 'zod';

export const PROPERTY_PURPOSES = ['SALE', 'RENT', 'SALE_AND_RENT'] as const;
export const PROPERTY_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'INACTIVE', 'ARCHIVED'] as const;
export const OWNER_TYPES = ['PERSON', 'COMPANY'] as const;

export type PropertyPurpose = (typeof PROPERTY_PURPOSES)[number];
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PURPOSE_LABELS: Record<PropertyPurpose, string> = {
  SALE: 'Venda', RENT: 'Aluguel', SALE_AND_RENT: 'Venda e aluguel',
};
export const STATUS_LABELS: Record<PropertyStatus, string> = {
  DRAFT: 'Rascunho', AVAILABLE: 'Disponível', RESERVED: 'Reservado', SOLD: 'Vendido',
  RENTED: 'Alugado', INACTIVE: 'Inativo', ARCHIVED: 'Arquivado',
};

const text = (max = 200) => z.string().trim().max(max).optional().nullable();
const money = z.number().min(0, 'Valor inválido').max(999_999_999_999, 'Valor inválido').optional().nullable();
const count = z.number().int().min(0).max(99).optional().nullable();
const area = z.number().min(0).max(99_999_999).optional().nullable();
const uuid = z.string().uuid().optional().nullable();

// ---------- Proprietários ----------
// Atenção: o `.default()` só vale na criação. `.partial()` de um campo com default reaplicaria o padrão
// em toda edição (sobrescrevendo o valor salvo), por isso a atualização parte de um schema sem defaults.
const ownerBase = z.object({
  type: z.enum(OWNER_TYPES),
  name: z.string().trim().min(2, 'Informe o nome').max(160),
  document: text(30),
  email: z.string().trim().toLowerCase().email('E-mail inválido').optional().nullable().or(z.literal('')),
  phone: text(30),
  whatsapp: text(30),
  address: text(200),
  city: text(100),
  state: z.string().trim().length(2, 'Use a sigla (UF)').toUpperCase().optional().nullable().or(z.literal('')),
  notes: text(2000),
});
export const ownerSchema = ownerBase.extend({ type: z.enum(OWNER_TYPES).default('PERSON') });
export const updateOwnerSchema = ownerBase.partial();
export type OwnerInput = z.infer<typeof ownerSchema>;

// ---------- Catálogo ----------
export const propertyTypeSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(60),
  active: z.boolean().optional(),
});
export const featureSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(60),
  category: text(40),
  icon: text(40),
  active: z.boolean().optional(),
});
export type FeatureInput = z.infer<typeof featureSchema>;

// ---------- Imóvel ----------
export const propertyBaseSchema = z.object({
  title: z.string().trim().min(3, 'Informe o título').max(160),
  shortDescription: text(300),
  description: text(10000),
  purpose: z.enum(PROPERTY_PURPOSES),
  typeId: z.string().uuid('Selecione o tipo'),
  subtype: text(60),
  status: z.enum(PROPERTY_STATUSES).optional(),
  ownerId: uuid,
  brokerId: uuid,
  branchId: uuid,
  salePrice: money,
  rentPrice: money,
  condominiumFee: money,
  propertyTax: money,
  minimumNegotiationPrice: money,
  bedrooms: count,
  suites: count,
  bathrooms: count,
  parkingSpaces: count,
  totalArea: area,
  usefulArea: area,
  builtArea: area,
  landArea: area,
  address: text(200),
  number: text(20),
  complement: text(100),
  neighborhood: text(100),
  city: text(100),
  state: z.string().trim().length(2, 'Use a sigla (UF)').toUpperCase().optional().nullable().or(z.literal('')),
  zipCode: text(12),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  showExactAddress: z.boolean().optional(),
  featured: z.boolean().optional(),
  featureIds: z.array(z.string().uuid()).max(100).optional(),
});

export const createPropertySchema = propertyBaseSchema;
export const updatePropertySchema = propertyBaseSchema.partial();
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

export const listPropertiesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  purpose: z.enum(PROPERTY_PURPOSES).optional(),
  typeId: z.string().uuid().optional(),
  brokerId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  city: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().max(100).optional(),
  published: z.enum(['true', 'false']).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).optional(),
});
export type ListPropertiesQuery = z.infer<typeof listPropertiesSchema>;
