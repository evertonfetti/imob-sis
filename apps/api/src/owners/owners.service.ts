import { Injectable } from '@nestjs/common';
import type { OwnerInput, Pagination } from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { blankToNull } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OwnersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(companyId: string, q: Pagination) {
    const where = {
      companyId,
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' as const } },
          { document: { contains: q.search } },
          { phone: { contains: q.search } },
          { email: { contains: q.search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.owner.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { _count: { select: { properties: true } } },
      }),
      this.prisma.owner.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(companyId: string, id: string) {
    const o = await this.prisma.owner.findFirst({
      where: { id, companyId },
      include: { properties: { select: { id: true, code: true, title: true, status: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!o) throw notFound('Proprietário não encontrado.');
    return o;
  }

  async create(ctx: AuthedCtx, input: OwnerInput) {
    const { companyId } = ctx.user;
    const owner = await this.prisma.owner.create({ data: { ...blankToNull(input), companyId } as never });
    await this.audit.record({ companyId, entity: 'OWNER', entityId: owner.id, action: 'CREATE', after: sanitize(owner), ctx });
    return owner;
  }

  async update(ctx: AuthedCtx, id: string, input: Partial<OwnerInput>) {
    const { companyId } = ctx.user;
    const current = await this.prisma.owner.findFirst({ where: { id, companyId } });
    if (!current) throw notFound('Proprietário não encontrado.');
    const updated = await this.prisma.owner.update({ where: { id }, data: blankToNull(input) as never });
    const d = diff(sanitize(current), sanitize(updated));
    if (d.changed) {
      await this.audit.record({ companyId, entity: 'OWNER', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    }
    return updated;
  }

  async remove(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const current = await this.prisma.owner.findFirst({ where: { id, companyId }, include: { _count: { select: { properties: true } } } });
    if (!current) throw notFound('Proprietário não encontrado.');
    if (current._count.properties > 0) throw new AppException('OWNER_HAS_PROPERTIES', 409);
    await this.prisma.owner.delete({ where: { id } });
    const { _count, ...row } = current;
    await this.audit.record({ companyId, entity: 'OWNER', entityId: id, action: 'DELETE', before: sanitize(row), ctx });
  }
}
