import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './app-exception';
import { IS_PUBLIC, PERMISSIONS_KEY } from './decorators';
import type { AuthedUser } from './request-context';

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

    let payload: { sub: string; cid: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new AppException('AUTH_TOKEN_INVALID', 401);
    }
    // Só tokens de acesso reais (com usuário e empresa) autenticam. Sem isto, o Prisma ignoraria um `id: undefined`
    // e a consulta devolveria o primeiro usuário da empresa.
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.cid !== 'string' || !payload.cid) {
      throw new AppException('AUTH_TOKEN_INVALID', 401);
    }

    // Consulta a cada requisição: status e permissões nunca ficam desatualizados.
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, companyId: payload.cid },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user) throw new AppException('AUTH_TOKEN_INVALID', 401);
    if (user.status !== 'ACTIVE') throw new AppException('AUTH_USER_INACTIVE', 403);

    const authed: AuthedUser = {
      id: user.id,
      companyId: user.companyId,
      branchId: user.branchId,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      roleKey: user.role.key,
      roleName: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
    };
    req.user = authed;
    req.log = req.log.child({ userId: authed.id, companyId: authed.companyId });
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<FastifyRequest>().user;
    if (!user || !required.every((p) => user.permissions.includes(p))) {
      throw new AppException('AUTH_FORBIDDEN', 403);
    }
    return true;
  }
}
