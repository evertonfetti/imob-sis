import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: path.resolve(__dirname, '../../../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(3333),
  ADMIN_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa ter 32+ caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  API_PUBLIC_URL: z.string().optional(),
  SITE_URL: z.string().optional(),
  // Chave para criptografar credenciais de integrações. Sem ela, deriva-se do JWT_ACCESS_SECRET.
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY precisa ter 32+ caracteres').optional(),
  // Espera entre as tentativas de envio à Meta (cresce exponencialmente). Configurável para testes.
  MARKETING_RETRY_DELAY_MS: z.coerce.number().default(5000),
  // Login com o Facebook (publicação em redes sociais). O app da Meta é da plataforma, não de cada empresa.
  GEMINI_API_URL: z.string().default('https://generativelanguage.googleapis.com/v1beta'),
  ANTHROPIC_API_URL: z.string().default('https://api.anthropic.com/v1'),
  GROQ_API_URL: z.string().default('https://api.groq.com/openai/v1'),
  OPENAI_API_URL: z.string().default('https://api.openai.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().default(120000),
  INTELLIGENCE_TICK_MS: z.coerce.number().default(600000), // rotinas de score e retomada de leads parados
  COMMERCIAL_TICK_MS: z.coerce.number().default(300000), // frequência da verificação de propostas vencidas
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_OAUTH_URL: z.string().default('https://www.facebook.com'),
  SOCIAL_POLL_MS: z.coerce.number().default(3000), // espera entre consultas do processamento de mídia do Instagram
  SOCIAL_TICK_MS: z.coerce.number().default(20000), // frequência do agendador de publicações
  WHATSAPP_GRAPH_URL: z.string().default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z.string().default('v22.0'),
  PUBLIC_COMPANY_ID: z.string().uuid().optional(),
  REDIS_URL: z.string().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).optional(),
  LOCAL_STORAGE_DIR: z.string().default('.data/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('imob-media'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
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
