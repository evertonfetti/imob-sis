import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { Env } from './config/env';

export function buildAdapter(env: Env) {
  return new FastifyAdapter({
    trustProxy: true,
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && h.length <= 100 ? h : randomUUID();
    },
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: ['req.headers.authorization', 'req.headers["x-license-key"]'],
            ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
          },
  });
}

export async function configureApp(app: NestFastifyApplication, env: Env) {
  // Webhook do Mercado Pago fica fora do prefixo: /webhooks/mercadopago
  app.setGlobalPrefix('v1', { exclude: [{ path: 'webhooks/(.*)', method: RequestMethod.ALL }] });
  await app.register(helmet);
  await app.register(cors, {
    // O painel master é a única origem do navegador; a instalação do cliente chama o heartbeat servidor-a-servidor (sem CORS).
    origin: [env.LICENSE_PANEL_URL],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id', 'x-license-key'],
    maxAge: 86400,
    exposedHeaders: ['x-request-id'],
  });
  app.getHttpAdapter().getInstance().addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
}

export async function createApp(env: Env) {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), buildAdapter(env), { bufferLogs: false });
  await configureApp(app, env);
  return app;
}
