import 'reflect-metadata';
import { hash } from '@node-rs/argon2';
import { createPrismaClient, seedCatalog, seedRoles } from '@imob/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';

export const PASSWORD = 'Senha@12345';

export async function bootApp() {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL });
  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app as NestFastifyApplication;
}

export async function resetAndSeed() {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL!);
  await prisma.$executeRawUnsafe(
    'TRUNCATE property_features, properties, features, property_types, owners, audit_logs, password_reset_tokens, refresh_tokens, users, role_permissions, roles, permissions, branches, companies CASCADE',
  );
  const passwordHash = await hash(PASSWORD);
  const out: Record<string, { companyId: string }> = {};
  for (const [tag, name] of [['A', 'Empresa A'], ['B', 'Empresa B']] as const) {
    const company = await prisma.company.create({ data: { name } });
    await seedRoles(prisma, company.id);
    await seedCatalog(prisma, company.id);
    for (const key of ['ADMIN', 'BROKER'] as const) {
      const role = await prisma.role.findUniqueOrThrow({ where: { companyId_key: { companyId: company.id, key } } });
      await prisma.user.create({
        data: {
          companyId: company.id,
          roleId: role.id,
          name: `${key} ${tag}`,
          email: `${key.toLowerCase()}.${tag.toLowerCase()}@teste.com`,
          passwordHash,
        },
      });
    }
    out[tag] = { companyId: company.id };
  }
  await prisma.$disconnect();
  return out;
}

export async function login(app: NestFastifyApplication, email: string, password = PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return { res, body: res.json() };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
