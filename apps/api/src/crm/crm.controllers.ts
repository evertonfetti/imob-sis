import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  assignLeadSchema, boardQuerySchema, changeStageSchema, createLeadSchema, createTaskSchema, customerSchema, listLeadsSchema, listTasksSchema,
  noteSchema, paginationSchema, updateCustomerSchema, updateLeadSchema, updateStageSchema, updateTaskSchema,
  type AssignLeadInput, type ChangeStageInput, type CreateLeadInput, type CreateTaskInput, type CustomerInput, type ListLeadsQuery,
  type Pagination, type UpdateLeadInput,
} from '@imob/types';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { CustomersService } from './customers.service';
import { LeadsService } from './leads.service';
import { PipelineService } from './pipeline.service';
import { TasksService } from './tasks.service';

const uuid = new ParseUUIDPipe();
const c = (ctx: ReqCtx) => ctx as AuthedCtx;

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get() @RequirePermissions('lead.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listLeadsSchema)) q: ListLeadsQuery): Promise<unknown> { return this.leads.list(ctx.user!, q); }

  @Get('summary') @RequirePermissions('lead.view')
  summary(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.leads.summary(ctx.user!); }

  @Post() @RequirePermissions('lead.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createLeadSchema)) body: CreateLeadInput): Promise<unknown> { return this.leads.create(c(ctx), body); }

  @Get(':id') @RequirePermissions('lead.view')
  get(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.leads.get(ctx.user!, id); }

  @Patch(':id') @RequirePermissions('lead.edit')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateLeadSchema)) body: UpdateLeadInput): Promise<unknown> { return this.leads.update(c(ctx), id, body); }

  @Post(':id/assign') @HttpCode(200) @RequirePermissions('lead.assign')
  assign(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(assignLeadSchema)) body: AssignLeadInput): Promise<unknown> { return this.leads.assign(c(ctx), id, body); }

  @Post(':id/change-stage') @HttpCode(200) @RequirePermissions('crm.pipeline')
  changeStage(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(changeStageSchema)) body: ChangeStageInput): Promise<unknown> { return this.leads.changeStage(c(ctx), id, body); }

  @Post(':id/notes') @RequirePermissions('lead.edit')
  note(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>): Promise<unknown> { return this.leads.addNote(c(ctx), id, body.text); }

  @Delete(':id') @HttpCode(204) @RequirePermissions('lead.delete')
  async remove(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) { await this.leads.remove(c(ctx), id); }
}

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get() @RequirePermissions('lead.view')
  get(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.pipeline.get(ctx.user!.companyId); }

  @Get('board') @RequirePermissions('lead.view')
  board(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(boardQuerySchema)) q: z.infer<typeof boardQuerySchema>): Promise<unknown> { return this.pipeline.board(ctx.user!, q); }

  @Patch('stages/:id') @RequirePermissions('crm.manage')
  stage(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateStageSchema)) body: z.infer<typeof updateStageSchema>): Promise<unknown> { return this.pipeline.updateStage(c(ctx), id, body); }
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get() @RequirePermissions('lead.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(paginationSchema)) q: Pagination): Promise<unknown> { return this.customers.list(ctx.user!, q); }

  @Post() @RequirePermissions('lead.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(customerSchema)) body: CustomerInput): Promise<unknown> { return this.customers.create(c(ctx), body); }

  @Get(':id') @RequirePermissions('lead.view')
  get(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.customers.get(ctx.user!, id); }

  @Patch(':id') @RequirePermissions('lead.edit')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateCustomerSchema)) body: Partial<CustomerInput>): Promise<unknown> { return this.customers.update(c(ctx), id, body); }
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get() @RequirePermissions('lead.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listTasksSchema)) q: z.infer<typeof listTasksSchema>): Promise<unknown> { return this.tasks.list(ctx.user!, q); }

  @Post() @RequirePermissions('lead.edit')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput): Promise<unknown> { return this.tasks.create(c(ctx), body); }

  @Patch(':id') @RequirePermissions('lead.edit')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateTaskSchema)) body: Partial<CreateTaskInput>): Promise<unknown> { return this.tasks.update(c(ctx), id, body); }

  @Post(':id/complete') @HttpCode(200) @RequirePermissions('lead.edit')
  complete(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.tasks.complete(c(ctx), id); }

  @Delete(':id') @HttpCode(204) @RequirePermissions('lead.edit')
  async cancel(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) { await this.tasks.cancel(c(ctx), id); }
}
