import { z } from 'zod';
import { ROLE_KEYS } from './permissions';

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo de 10 caracteres')
  .regex(/[A-Za-z]/, 'Inclua ao menos uma letra')
  .regex(/\d/, 'Inclua ao menos um número');

const emailSchema = z.string().trim().toLowerCase().email('E-mail inválido');
const optionalText = z.string().trim().max(200).optional().nullable();

export const USER_STATUS = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

// ---------- Auth ----------
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export interface AuthUser {
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: { key: string; name: string };
  permissions: string[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

// ---------- Usuários ----------
export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: emailSchema,
  phone: optionalText,
  creci: optionalText,
  branchId: z.string().uuid().optional().nullable(),
  roleKey: z.enum(ROLE_KEYS),
  password: passwordSchema,
});
export const updateUserSchema = createUserSchema
  .omit({ password: true })
  .partial()
  .extend({
    status: z.enum(USER_STATUS).optional(),
    password: passwordSchema.optional(),
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ---------- Empresa / Filiais ----------
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use o formato #RRGGBB');
export const updateCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    tradeName: optionalText,
    document: optionalText,
    creci: optionalText,
    email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('')),
    phone: optionalText,
    whatsapp: optionalText,
    website: optionalText,
    logoUrl: optionalText,
    primaryColor: hexColor.optional().nullable(),
    secondaryColor: hexColor.optional().nullable(),
    leadDistribution: z.enum(['MANUAL', 'ROUND_ROBIN']).optional(),
  })
  .partial();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: optionalText,
  whatsapp: optionalText,
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('')),
  address: optionalText,
  city: optionalText,
  state: z.string().trim().length(2).toUpperCase().optional().nullable(),
  zipCode: optionalText,
  active: z.boolean().optional(),
});
export const updateBranchSchema = branchSchema.partial();
export type BranchInput = z.infer<typeof branchSchema>;

// ---------- Listagens ----------
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
