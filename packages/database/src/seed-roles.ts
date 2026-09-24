import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_LABELS,
} from '@imob/types';
import type { PrismaClient } from './generated/client';

/** Cria/atualiza permissões e papéis de uma empresa. Idempotente. */
export async function seedRoles(prisma: PrismaClient, companyId: string) {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSIONS[key] },
      create: { key, description: PERMISSIONS[key] },
    });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  for (const key of ROLE_KEYS) {
    const role = await prisma.role.upsert({
      where: { companyId_key: { companyId, key } },
      update: { name: ROLE_LABELS[key] },
      create: { companyId, key, name: ROLE_LABELS[key] },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
    });
  }
}

