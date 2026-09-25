import { Injectable } from '@nestjs/common';
import type { CustomerInput, Pagination } from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { blankToNull } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';
import { canViewAll } from './visibility';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Quem não vê todos os leads só enxerga clientes que têm algum lead seu. */
  private scope(user: AuthedUser) {
    return { companyId: user.companyId, ...(canViewAll(user) ? {} : { leads: { some: { brokerId: user.id } } }) };
  }

  async list(user: AuthedUser, q: Pagination) {
    const where = {
      ...this.scope(user),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: 'insensitive' as const } },
          { phone: { contains: q.search.replace(/\D/g, '') || q.search } },
          { email: { contains: q.search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { _count: { select: { leads: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(user: AuthedUser, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        leads: {
          where: canViewAll(user) ? {} : { brokerId: user.id }, orderBy: { createdAt: 'desc' },
          include: { property: { select: { id: true, code: true, title: true } }, stage: { select: { id: true, name: true, color: true } }, broker: { select: { id: true, name: true } } },
        },
      },
    });
    if (!c) throw notFound('Cliente não encontrado.');
    return c;
  }

  async create(ctx: AuthedCtx, input: CustomerInput) {
    const { companyId } = ctx.user;
    const data = blankToNull(input) as CustomerInput;
    const phone = data.phone ? data.phone.replace(/\D/g, '') : null;
    const c = await this.prisma.customer.create({ data: { ...data, phone, whatsapp: phone, companyId } as never });
    await this.audit.record({ companyId, entity: 'CUSTOMER', entityId: c.id, action: 'CREATE', after: sanitize(c), ctx });
    return c;
  }

  async update(ctx: AuthedCtx, id: string, input: Partial<CustomerInput>) {
    const { companyId } = ctx.user;
    const current = await this.get(ctx.user, id);
    const data: Record<string, unknown> = { ...blankToNull(input) };
    if (typeof data.phone === 'string') data.phone = data.phone.replace(/\D/g, '') || null;
    const { leads: _l, ...before } = current;
    const updated = await this.prisma.customer.update({ where: { id }, data });
    const d = diff(sanitize(before), sanitize(updated));
    if (d.changed) await this.audit.record({ companyId, entity: 'CUSTOMER', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    return updated;
  }
}
