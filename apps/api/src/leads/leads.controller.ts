import { Controller, Get, Query } from '@nestjs/common';
import { LEAD_SOURCES, LEAD_STATUSES, paginationSchema } from '@imob/types';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators';
import { AuthedUser, CurrentUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const querySchema = paginationSchema.extend({
  source: z.enum(LEAD_SOURCES).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});

/** Bloco 4: apenas a lista de leads recebidos. Funil, kanban e atendimento chegam no Bloco 5. */
@Controller('leads')
export class LeadsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('lead.view')
  async list(@CurrentUser() user: AuthedUser, @Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>): Promise<unknown> {
    const where = {
      companyId: user.companyId,
      ...(q.source && { source: q.source }),
      ...(q.status && { status: q.status }),
      ...(q.search && {
        customer: { OR: [
          { name: { contains: q.search, mode: 'insensitive' as const } },
          { phone: { contains: q.search.replace(/\D/g, '') || q.search } },
          { email: { contains: q.search, mode: 'insensitive' as const } },
        ] },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true, email: true } },
          property: { select: { id: true, code: true, title: true } },
          broker: { select: { id: true, name: true } },
          attribution: { select: { utmSource: true, utmMedium: true, utmCampaign: true, fbclid: true, gclid: true, landingPage: true } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items: rows, total, page: q.page, pageSize: q.pageSize };
  }

  @Get('summary')
  @RequirePermissions('lead.view')
  async summary(@CurrentUser() user: AuthedUser) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [last7, total, fresh] = await Promise.all([
      this.prisma.lead.count({ where: { companyId: user.companyId, createdAt: { gte: since } } }),
      this.prisma.lead.count({ where: { companyId: user.companyId } }),
      this.prisma.lead.count({ where: { companyId: user.companyId, status: 'NEW' } }),
    ]);
    return { last7Days: last7, total, new: fresh };
  }
}
