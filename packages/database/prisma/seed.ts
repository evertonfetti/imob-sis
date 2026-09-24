import path from 'node:path';
import { config } from 'dotenv';
import { bootstrap, createPrismaClient } from '../src';

config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const prisma = createPrismaClient(process.env.DATABASE_URL!);
  try {
    const r = await bootstrap(prisma, {
      adminEmail: process.env.SEED_ADMIN_EMAIL,
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
    });
    console.log(r.adminCreated ? `Administrador criado: ${r.email}` : 'Seed concluído.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
