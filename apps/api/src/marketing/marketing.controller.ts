import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { listMarketingEventsSchema, marketingPeriodSchema, metaIntegrationSchema, type MetaIntegrationInput } from '@imob/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/app-exception';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingReportsService } from './marketing-reports.service';
import { MarketingService } from './marketing.service';
import { MetaIntegrationService } from './meta-integration.service';

const uuid = new ParseUUIDPipe();
const c = (ctx: ReqCtx) => ctx as AuthedCtx;
const stageEventSchema = z.object({ metaEvent: z.enum(['QualifiedLead', 'Schedule', 'Purchase']).nullable() });

@Controller('marketing')
export class MarketingController {
  constructor(
    private readonly reports: MarketingReportsService,
    private readonly marketing: MarketingService,
    private readonly meta: MetaIntegrationService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Relatórios ----------
  @Get('overview') @RequirePermissions('marketing.view')
  overview(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(marketingPeriodSchema)) q: z.infer<typeof marketingPeriodSchema>): Promise<unknown> { return this.reports.overview(ctx.user!.companyId, q.days); }

  @Get('campaigns') @RequirePermissions('marketing.view')
  campaigns(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(marketingPeriodSchema)) q: z.infer<typeof marketingPeriodSchema>): Promise<unknown> { return this.reports.campaigns(ctx.user!.companyId, q.days); }

  @Get('sources') @RequirePermissions('marketing.view')
  sources(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(marketingPeriodSchema)) q: z.infer<typeof marketingPeriodSchema>): Promise<unknown> { return this.reports.sources(ctx.user!.companyId, q.days); }

  // ---------- Histórico de eventos enviados à Meta ----------
  @Get('events') @RequirePermissions('marketing.view')
  async events(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listMarketingEventsSchema)) q: z.infer<typeof listMarketingEventsSchema>) {
    const where = { companyId: ctx.user!.companyId, ...(q.status && { status: q.status }), ...(q.eventName && { eventName: q.eventName }) };
    const [rows, total] = await Promise.all([
      this.prisma.marketingEvent.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        select: { id: true, eventName: true, eventId: true, status: true, error: true, attempts: true, createdAt: true, sentAt: true, response: true, lead: { select: { id: true, customer: { select: { name: true } } } } },
      }),
      this.prisma.marketingEvent.count({ where }),
    ]);
    return { items: rows, total, page: q.page, pageSize: q.pageSize };
  }

  @Post('events/:id/retry') @HttpCode(200) @RequirePermissions('marketing.manage')
  retry(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.marketing.retry(ctx.user!.companyId, id); }

  // ---------- Etapa do funil → evento da Meta ----------
  @Patch('stage-events/:stageId') @RequirePermissions('marketing.manage')
  async stageEvent(@Ctx() ctx: ReqCtx, @Param('stageId', uuid) stageId: string, @Body(new ZodPipe(stageEventSchema)) body: z.infer<typeof stageEventSchema>) {
    const { companyId } = ctx.user!;
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline: { companyId } } });
    if (!stage) throw notFound('Etapa não encontrada.');
    const updated = await this.prisma.pipelineStage.update({ where: { id: stageId }, data: { metaEvent: body.metaEvent } });
    if (stage.metaEvent !== updated.metaEvent) {
      await this.audit.record({ companyId, entity: 'PIPELINE_STAGE', entityId: stageId, action: 'UPDATE', before: { metaEvent: stage.metaEvent }, after: { metaEvent: updated.metaEvent }, ctx: c(ctx) });
    }
    return { id: updated.id, name: updated.name, metaEvent: updated.metaEvent };
  }

  // ---------- Conexão com a Meta (Pixel + Conversions API) ----------
  @Get('integrations/meta') @RequirePermissions('marketing.capi')
  status(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.meta.status(ctx.user!.companyId); }

  @Put('integrations/meta') @RequirePermissions('marketing.capi')
  save(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(metaIntegrationSchema)) body: MetaIntegrationInput): Promise<unknown> { return this.meta.save(c(ctx), body); }

  @Post('integrations/meta/test') @HttpCode(200) @RequirePermissions('marketing.capi')
  test(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.meta.test(c(ctx)); }

  @Post('integrations/meta/test-event') @HttpCode(200) @RequirePermissions('marketing.capi')
  testEvent(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.marketing.sendTestEvent(ctx.user!.companyId); }

  @Delete('integrations/meta') @HttpCode(204) @RequirePermissions('marketing.capi')
  async remove(@Ctx() ctx: ReqCtx) { await this.meta.remove(c(ctx)); }
}
