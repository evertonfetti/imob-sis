import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.setup';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await createApp(env);
  app.enableShutdownHooks();
  await app.listen(env.API_PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`API pronta em http://localhost:${env.API_PORT}/api/v1`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
