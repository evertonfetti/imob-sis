import { DbClient } from './index';
import { bootstrap } from './bootstrap';

async function main() {
  const url = process.env.LICENSE_DATABASE_URL;
  if (!url) throw new Error('LICENSE_DATABASE_URL não definida');
  const prisma = new DbClient(url);
  try {
    const r = await bootstrap(prisma, {
      staffEmail: process.env.SEED_STAFF_EMAIL,
      staffPassword: process.env.SEED_STAFF_PASSWORD,
      staffName: process.env.SEED_STAFF_NAME,
    });
    console.log(r.staffCreated ? `[bootstrap] funcionário criado: ${r.email}` : '[bootstrap] ok');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[bootstrap] falhou:', e);
  process.exit(1);
});
