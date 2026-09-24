import { DEFAULT_FEATURES, DEFAULT_PROPERTY_TYPES, slugify } from '@imob/types';
import type { PrismaClient } from './generated/client';

/** Cria o catálogo inicial só quando a empresa ainda não tem nenhum item (não recria o que foi removido). */
export async function seedCatalog(prisma: PrismaClient, companyId: string) {
  if ((await prisma.propertyType.count({ where: { companyId } })) === 0) {
    await prisma.propertyType.createMany({ data: DEFAULT_PROPERTY_TYPES.map((name) => ({ companyId, name })) });
  }
  if ((await prisma.feature.count({ where: { companyId } })) === 0) {
    await prisma.feature.createMany({
      data: DEFAULT_FEATURES.map((f) => ({ companyId, name: f.name, category: f.category, slug: slugify(f.name) })),
    });
  }
}
