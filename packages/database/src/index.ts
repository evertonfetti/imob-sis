import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';

export function createPrismaClient(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** PrismaClient já configurado com o adapter `pg` (Prisma 7). */
export class DbClient extends PrismaClient {
  constructor(connectionString: string) {
    super({ adapter: new PrismaPg({ connectionString }) });
  }
}
export { seedRoles } from './seed-roles';
export { bootstrap, type BootstrapOptions } from './bootstrap';
export { seedCatalog } from './seed-catalog';
export { ensureDefaultPipeline, backfillLeadStages } from './seed-pipeline';
