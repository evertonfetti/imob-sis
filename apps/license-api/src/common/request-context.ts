import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AuthedStaff {
  id: string;
  name: string;
  email: string;
}

export interface ReqCtx {
  staff?: AuthedStaff;
  ip?: string;
  userAgent?: string;
}

export type AuthedCtx = ReqCtx & { staff: AuthedStaff };

declare module 'fastify' {
  interface FastifyRequest {
    staff?: AuthedStaff;
  }
}

export function buildCtx(req: FastifyRequest): ReqCtx {
  const ua = req.headers['user-agent'];
  return { staff: req.staff, ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined };
}

/** Contexto da requisição (funcionário autenticado, IP, user-agent). */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): ReqCtx =>
  buildCtx(host.switchToHttp().getRequest<FastifyRequest>()),
);

export const CurrentStaff = createParamDecorator(
  (_: unknown, host: ExecutionContext): AuthedStaff => host.switchToHttp().getRequest<FastifyRequest>().staff!,
);
