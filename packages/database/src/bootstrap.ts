import { hash } from '@node-rs/argon2';
import type { PrismaClient } from './generated/client';
import { seedRoles } from './seed-roles';

export interface BootstrapOptions {
  adminEmail?: string;
  adminPassword?: string;
  companyName?: string;
}

/**
 * Idempotente — roda a cada deploy:
 * - garante empresa/filial iniciais;
 * - sincroniza permissões e papéis padrão (novas permissões entram sozinhas);
 * - cria o primeiro administrador somente se ainda não existir.
 */
export async function bootstrap(prisma: PrismaClient, opts: BootstrapOptions = {}) {
  let company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    const name = opts.companyName ?? 'Minha Imobiliária';
    company = await prisma.company.create({ data: { name, tradeName: name } });
    await prisma.branch.create({ data: { companyId: company.id, name: 'Matriz' } });
  }
  await seedRoles(prisma, company.id);

  if (!opts.adminEmail || !opts.adminPassword) return { adminCreated: false };
  const email = opts.adminEmail.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return { adminCreated: false };

  const role = await prisma.role.findUniqueOrThrow({ where: { companyId_key: { companyId: company.id, key: 'ADMIN' } } });
  const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
  await prisma.user.create({
    data: {
      companyId: company.id,
      branchId: branch?.id,
      roleId: role.id,
      name: 'Administrador',
      email,
      passwordHash: await hash(opts.adminPassword),
    },
  });
  return { adminCreated: true, email };
}
