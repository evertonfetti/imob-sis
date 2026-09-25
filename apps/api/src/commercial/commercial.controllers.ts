import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  counterProposalSchema, createProposalSchema, createVisitSchema, listProposalsSchema, listVisitsSchema, updateProposalSchema, updateVisitSchema,
  type CounterProposalInput, type CreateProposalInput, type CreateVisitInput, type UpdateProposalInput, type UpdateVisitInput,
} from '@imob/types';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { CommercialSummaryService } from './commercial-summary.service';
import { ProposalsService } from './proposals.service';
import { VisitsService } from './visits.service';

const uuid = new ParseUUIDPipe();
const c = (ctx: ReqCtx) => ctx as AuthedCtx;

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get() @RequirePermissions('visit.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listVisitsSchema)) q: z.infer<typeof listVisitsSchema>): Promise<unknown> { return this.visits.list(ctx.user!, q); }

  @Get(':id') @RequirePermissions('visit.view')
  get(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.visits.get(ctx.user!, id); }

  @Post() @RequirePermissions('visit.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createVisitSchema)) body: CreateVisitInput): Promise<unknown> { return this.visits.create(c(ctx), body); }

  @Patch(':id') @RequirePermissions('visit.edit')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateVisitSchema)) body: UpdateVisitInput): Promise<unknown> { return this.visits.update(c(ctx), id, body); }
}

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get() @RequirePermissions('proposal.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listProposalsSchema)) q: z.infer<typeof listProposalsSchema>): Promise<unknown> { return this.proposals.list(ctx.user!, q); }

  @Get(':id') @RequirePermissions('proposal.view')
  get(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.proposals.get(ctx.user!, id); }

  @Post() @RequirePermissions('proposal.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createProposalSchema)) body: CreateProposalInput): Promise<unknown> { return this.proposals.create(c(ctx), body); }

  @Patch(':id') @RequirePermissions('proposal.create')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateProposalSchema)) body: UpdateProposalInput): Promise<unknown> { return this.proposals.update(c(ctx), id, body); }

  @Post(':id/counter') @HttpCode(200) @RequirePermissions('proposal.create')
  counter(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(counterProposalSchema)) body: CounterProposalInput): Promise<unknown> { return this.proposals.counter(c(ctx), id, body); }

  @Post(':id/close') @HttpCode(200) @RequirePermissions('proposal.manage')
  close(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.proposals.closeDeal(c(ctx), id); }
}

@Controller('commercial')
export class CommercialController {
  constructor(private readonly summary: CommercialSummaryService) {}

  @Get('summary') @RequirePermissions('visit.view')
  get(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.summary.get(ctx.user!); }
}
