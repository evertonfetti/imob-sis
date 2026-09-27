import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './app-exception';
import { IS_PUBLIC } from './decorators';

/** Só existe um "papel": funcionário da plataforma (você e sua equipe). Sem RBAC — não é o sistema do cliente. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppException('AUTH_TOKEN_INVALID', 401);

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new AppException('AUTH_TOKEN_INVALID', 401);
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw new AppException('AUTH_TOKEN_INVALID', 401);

    const staff = await this.prisma.staffUser.findUnique({ where: { id: payload.sub } });
    if (!staff) throw new AppException('AUTH_TOKEN_INVALID', 401);
    if (staff.status !== 'ACTIVE') throw new AppException('AUTH_USER_INACTIVE', 403);

    req.staff = { id: staff.id, name: staff.name, email: staff.email };
    req.log = req.log.child({ staffId: staff.id });
    return true;
  }
}
