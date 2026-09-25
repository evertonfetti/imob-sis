import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { reportQuerySchema, type ReportQuery } from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { notFound } from '../common/app-exception';
import { Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { leadScope } from '../crm/visibility';
import { AlertsService } from './alerts.service';
import { LeadScoreService } from './lead-score.service';
import { MatchingService } from './matching.service';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class IntelligenceController {
  constructor(
    private readonly prisma: PrismaService, private readonly score: LeadScoreService, private readonly matching: MatchingService,
    private readonly reports: ReportsService, private readonly alerts: AlertsService,
  ) {}

  @Get('leads/:id/score') @RequirePermissions('lead.view')
  async leadScore(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    const u = ctx.user!;
    if (!(await this.prisma.lead.findFirst({ where: { id, ...leadScope(u) }, select: { id: true } }))) throw notFound('Lead não encontrado.');
    return this.score.explain(u.companyId, id);
  }

  @Get('leads/:id/matches') @RequirePermissions('lead.view')
  leadMatches(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.matching.matchLeadToProperties(ctx.user!.companyId, id, { scope: leadScope(ctx.user!) });
  }

  @Get('properties/:id/matches') @RequirePermissions('lead.view', 'property.view')
  propertyMatches(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.matching.matchPropertyToLeads(ctx.user!.companyId, id, { scope: leadScope(ctx.user!) });
  }

  @Get('reports/overview') @RequirePermissions('lead.view')
  overview(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery): Promise<unknown> { return this.reports.overview(ctx.user!, q); }

  @Get('alerts') @RequirePermissions('lead.view')
  async list(@Ctx() ctx: ReqCtx): Promise<unknown> {
    const items = await this.alerts.list(ctx.user!);
    return { total: items.length, high: items.filter((a) => a.severity === 'high').length, items: items.slice(0, 40) };
  }
}
