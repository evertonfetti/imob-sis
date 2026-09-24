import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { Env } from './config/env';

export function buildAdapter(env: Env) {
  return new FastifyAdapter({
    trustProxy: true, // atrás do proxy do Easypanel/Traefik: IP real do cliente
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && h.length <= 100 ? h : randomUUID();
    },
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: ['req.headers.authorization'],
            ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
          },
  });
}

export async function configureApp(app: NestFastifyApplication, env: Env) {
  app.setGlobalPrefix('api/v1');
  await app.register(helmet);
  await app.register(cors, {
    origin: [env.ADMIN_URL],
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.getHttpAdapter().getInstance().addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
}

export async function createApp(env: Env) {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), buildAdapter(env), {
    bufferLogs: false,
  });
  await configureApp(app, env);
  return app;
}
