import { DbClient } from './index';
import { bootstrap } from './bootstrap';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida');
  const prisma = new DbClient(url);
  try {
    const r = await bootstrap(prisma, {
      adminEmail: process.env.SEED_ADMIN_EMAIL,
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      companyName: process.env.SEED_COMPANY_NAME,
    });
    console.log(r.adminCreated ? `[bootstrap] administrador criado: ${r.email}` : '[bootstrap] ok');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[bootstrap] falhou:', e);
  process.exit(1);
});
