import { Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { CreateUserInput, Pagination, UpdateUserInput } from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const include = { role: true, branch: { select: { id: true, name: true } } } as const;

function present(u: { passwordHash: string; role: { key: string; name: string } } & Record<string, unknown>) {
  const { passwordHash: _p, ...rest } = u;
  return rest;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(companyId: string, q: Pagination) {
    const where = {
      companyId,
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' as const } },
          { email: { contains: q.search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include,
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(present), total, page: q.page, pageSize: q.pageSize };
  }

  async get(companyId: string, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, companyId }, include });
    if (!u) throw notFound('Usuário não encontrado.');
    return present(u);
  }

  private assertCanTouchRole(ctx: AuthedCtx, roleKey: string) {
    if (roleKey === 'ADMIN' && ctx.user.roleKey !== 'ADMIN') throw new AppException('AUTH_FORBIDDEN', 403);
  }

  private async resolveRole(companyId: string, key: string) {
    const role = await this.prisma.role.findUnique({ where: { companyId_key: { companyId, key } } });
    if (!role) throw new AppException('USER_ROLE_INVALID', 400);
    return role;
  }

  private async assertBranch(companyId: string, branchId?: string | null) {
    if (!branchId) return;
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, companyId } });
    if (!b) throw new AppException('BRANCH_INVALID', 400);
  }

  async create(ctx: AuthedCtx, input: CreateUserInput) {
    const { companyId } = ctx.user;
    this.assertCanTouchRole(ctx, input.roleKey);
    const role = await this.resolveRole(companyId, input.roleKey);
    await this.assertBranch(companyId, input.branchId);
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new AppException('USER_EMAIL_TAKEN', 409);
    }
    const created = await this.prisma.user.create({
      data: {
        companyId,
        roleId: role.id,
        branchId: input.branchId ?? null,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        creci: input.creci ?? null,
        passwordHash: await hash(input.password),
      },
      include,
    });
    const out = present(created);
    await this.audit.record({ companyId, entity: 'USER', entityId: created.id, action: 'CREATE', after: sanitize(out), ctx });
    return out;
  }

  async update(ctx: AuthedCtx, id: string, input: UpdateUserInput) {
    const { companyId } = ctx.user;
    const current = await this.prisma.user.findFirst({ where: { id, companyId }, include });
    if (!current) throw notFound('Usuário não encontrado.');
    this.assertCanTouchRole(ctx, current.role.key);

    const { roleKey, password, ...rest } = input;
    const data: Record<string, unknown> = { ...rest };

    if (roleKey) {
      this.assertCanTouchRole(ctx, roleKey);
      data.roleId = (await this.resolveRole(companyId, roleKey)).id;
    }
    if ('branchId' in input) await this.assertBranch(companyId, input.branchId);
    if (input.email && input.email !== current.email) {
      if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
        throw new AppException('USER_EMAIL_TAKEN', 409);
      }
    }
    if (id === ctx.user.id && input.status && input.status !== 'ACTIVE') {
      throw new AppException('USER_SELF_DELETE', 400);
    }
    if (password) data.passwordHash = await hash(password);

    const updated = await this.prisma.user.update({ where: { id }, data, include });
    if (password || (input.status && input.status !== 'ACTIVE')) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    const d = diff(sanitize(current), sanitize(updated));
    if (password) d.after.password = '[alterada]';
    if (d.changed || password) {
      await this.audit.record({
        companyId,
        entity: 'USER',
        entityId: id,
        action: roleKey && roleKey !== current.role.key ? 'ROLE_CHANGE' : 'UPDATE',
        before: d.before,
        after: d.after,
        ctx,
      });
    }
    return present(updated);
  }

  /** Usuários têm histórico (auditoria, leads, visitas): "excluir" desativa e encerra sessões. */
  async deactivate(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    if (id === ctx.user.id) throw new AppException('USER_SELF_DELETE', 400);
    const current = await this.prisma.user.findFirst({ where: { id, companyId }, include });
    if (!current) throw notFound('Usuário não encontrado.');
    this.assertCanTouchRole(ctx, current.role.key);

    await this.prisma.user.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({
      companyId,
      entity: 'USER',
      entityId: id,
      action: 'DEACTIVATE',
      before: { status: current.status },
      after: { status: 'INACTIVE' },
      ctx,
    });
  }
}
