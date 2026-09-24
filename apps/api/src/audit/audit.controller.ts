import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { paginationSchema } from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { CurrentUser, AuthedUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const querySchema = paginationSchema.extend({
  entity: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().uuid().optional(),
});

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('admin.audit')
  async list(@CurrentUser() user: AuthedUser, @Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>): Promise<unknown> {
    const where = {
      companyId: user.companyId,
      ...(q.entity && { entity: q.entity }),
      ...(q.action && { action: q.action }),
      ...(q.userId && { userId: q.userId }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, companyId: user.companyId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: rows.map((r) => ({ ...r, userName: r.userId ? (names.get(r.userId) ?? null) : null })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
