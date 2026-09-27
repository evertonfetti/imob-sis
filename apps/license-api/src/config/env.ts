import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: path.resolve(__dirname, '../../../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LICENSE_API_PORT: z.coerce.number().default(3433),
  LICENSE_PANEL_URL: z.string().default('http://localhost:5273'),
  LICENSE_DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa ter 32+ caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  // Fase 2 (cobrança). Sem MP_ACCESS_TOKEN, a cobrança automática fica desativada: crie/gerencie licenças manualmente.
  MP_ACCESS_TOKEN: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),
  MP_API_URL: z.string().default('https://api.mercadopago.com'),
  LICENSE_API_PUBLIC_URL: z.string().optional(),
  // Os prazos (aviso e tolerância) ficam no banco (tabela BillingSettings), ajustáveis no painel master.
  BILLING_TICK_MS: z.coerce.number().default(3600_000),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Variáveis vazias (comuns em docker-compose) valem como "não definidas".
  const clean = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(clean);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${msg}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
