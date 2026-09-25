import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  agentSettingsSchema, agentTestSchema, documentConfirmSchema, documentUploadSchema, updateDocumentSchema,
  type AgentTestInput, type DocumentConfirmInput, type DocumentUploadInput, type UpdateAgentSettingsInput, type UpdateDocumentInput,
} from '@imob/types';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AgentSettingsService } from './agent-settings.service';
import { AgentService } from './agent.service';
import { KnowledgeService } from './knowledge.service';

const uuid = new ParseUUIDPipe();
const origin = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}`;

@Controller('agent')
@RequirePermissions('admin.company')
export class AgentController {
  constructor(private readonly settings: AgentSettingsService, private readonly agent: AgentService, private readonly docs: KnowledgeService) {}

  @Get('settings')
  get(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.settings.dto(ctx.user!.companyId); }

  @Put('settings')
  save(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(agentSettingsSchema)) body: UpdateAgentSettingsInput): Promise<unknown> { return this.settings.update(ctx as AuthedCtx, body); }

  @Get('runs')
  runs(@Ctx() ctx: ReqCtx, @Query('limit') limit?: string): Promise<unknown> { return this.settings.runs(ctx.user!.companyId, Math.min(100, Math.max(1, Number(limit) || 30))); }

  @Post('test') @HttpCode(200)
  test(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(agentTestSchema)) body: AgentTestInput): Promise<unknown> { return this.agent.test(ctx.user!.companyId, body); }

  // ---------- Documentos (base de conhecimento) ----------
  @Get('documents')
  list(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.docs.list(ctx.user!.companyId); }

  @Post('documents/upload-url') @HttpCode(200)
  uploadUrl(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest, @Body(new ZodPipe(documentUploadSchema)) body: DocumentUploadInput): Promise<unknown> { return this.docs.createUpload(ctx.user!.companyId, body, origin(req)); }

  @Post('documents') @HttpCode(201)
  confirm(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(documentConfirmSchema)) body: DocumentConfirmInput): Promise<unknown> { return this.docs.confirm(ctx as AuthedCtx, body); }

  @Patch('documents/:id')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateDocumentSchema)) body: UpdateDocumentInput): Promise<unknown> { return this.docs.update(ctx as AuthedCtx, id, body); }

  @Delete('documents/:id') @HttpCode(204)
  async remove(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) { await this.docs.remove(ctx as AuthedCtx, id); }
}
