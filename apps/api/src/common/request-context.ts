import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export interface AuthedUser {
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  roleKey: string;
  roleName: string;
  permissions: string[];
}

export interface ReqCtx {
  user?: AuthedUser;
  ip?: string;
  userAgent?: string;
}

export type AuthedCtx = ReqCtx & { user: AuthedUser };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export function buildCtx(req: FastifyRequest): ReqCtx {
  const ua = req.headers['user-agent'];
  return { user: req.user, ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined };
}

/** Contexto da requisição (usuário autenticado, IP, user-agent). */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): ReqCtx =>
  buildCtx(host.switchToHttp().getRequest<FastifyRequest>()),
);

export const CurrentUser = createParamDecorator(
  (_: unknown, host: ExecutionContext): AuthedUser => host.switchToHttp().getRequest<FastifyRequest>().user!,
);
