import 'reflect-metadata';
import { hash } from '@node-rs/argon2';
import { createPrismaClient } from '@imob/license-database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';

export const PASSWORD = 'Senha@12345';

export async function bootApp(extra: Record<string, string> = {}) {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test', LICENSE_DATABASE_URL: process.env.TEST_LICENSE_DATABASE_URL, ...extra });
  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app as NestFastifyApplication;
}

export async function resetAndSeed() {
  const prisma = createPrismaClient(process.env.TEST_LICENSE_DATABASE_URL!);
  await prisma.$executeRawUnsafe(
    'TRUNCATE license_events, usage_snapshots, invoices, licenses, plans, clients, refresh_tokens, password_reset_tokens, staff_users, billing_settings CASCADE',
  );
  await prisma.staffUser.create({ data: { name: 'Staff', email: 'staff@teste.com', passwordHash: await hash(PASSWORD) } });
  await prisma.$disconnect();
}

export async function login(app: NestFastifyApplication, email: string) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: PASSWORD } });
  return { status: r.statusCode, body: r.json() };
}

export const auth = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
