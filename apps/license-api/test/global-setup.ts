import { execSync } from 'node:child_process';
import path from 'node:path';
import { config } from 'dotenv';

export default function setup() {
  config({ path: path.resolve(__dirname, '../../../.env') });
  const url = process.env.TEST_LICENSE_DATABASE_URL;
  if (!url) throw new Error('Defina TEST_LICENSE_DATABASE_URL no .env');
  execSync('pnpm --filter @imob/license-database exec prisma migrate deploy', {
    env: { ...process.env, LICENSE_DATABASE_URL: url },
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../../..'),
  });
}
