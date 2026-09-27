import { hash } from '@node-rs/argon2';
import type { PrismaClient } from './generated/client';

export interface BootstrapOptions {
  staffEmail?: string;
  staffPassword?: string;
  staffName?: string;
}

/** Idempotente — roda a cada deploy: cria o primeiro funcionário do painel master, só se ainda não existir nenhum. */
export async function bootstrap(prisma: PrismaClient, opts: BootstrapOptions = {}) {
  if (!opts.staffEmail || !opts.staffPassword) return { staffCreated: false };
  const email = opts.staffEmail.toLowerCase();
  if (await prisma.staffUser.findUnique({ where: { email } })) return { staffCreated: false };
  await prisma.staffUser.create({
    data: { name: opts.staffName ?? 'Administrador', email, passwordHash: await hash(opts.staffPassword) },
  });
  return { staffCreated: true, email };
}
