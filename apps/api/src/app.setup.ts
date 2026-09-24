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
    // O painel roda em outro domínio da API: PATCH/PUT/DELETE precisam estar liberados no preflight.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    maxAge: 86400,
    exposedHeaders: ['x-request-id'],
  });
  // Uploads locais chegam como binário: entregamos o stream cru ao endpoint (sem carregar tudo em memória).
  app.getHttpAdapter().getInstance().addContentTypeParser('*', (_req: unknown, payload: unknown, done: (e: Error | null, b?: unknown) => void) => done(null, payload));
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
