import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { aiSettingsSchema, createGenerationSchema, type AiSettingsInput, type CreateGenerationInput } from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AiImagesService } from './ai-images.service';
import { AiSettingsService } from './ai-settings.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class AiController {
  constructor(private readonly images: AiImagesService, private readonly settings: AiSettingsService) {}

  // Configuração do provedor: administração da empresa (guarda a chave paga).
  @Get('ai/settings') @RequirePermissions('admin.company')
  getSettings(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.settings.dto(ctx.user!.companyId); }

  @Put('ai/settings') @RequirePermissions('admin.company')
  saveSettings(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(aiSettingsSchema)) body: AiSettingsInput): Promise<unknown> { return this.settings.save(ctx as AuthedCtx, body); }

  // Quem edita fotos com IA consulta o que está disponível (provedor e uso), sem ver chaves.
  @Get('ai/status') @RequirePermissions('media.ai_edit')
  status(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.settings.dto(ctx.user!.companyId); }

  @Get('media/:id/versions') @RequirePermissions('media.view')
  versions(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.images.versions(ctx.user!, id); }

  @Post('media/:id/generations') @HttpCode(201) @RequirePermissions('media.ai_edit')
  create(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(createGenerationSchema)) body: CreateGenerationInput): Promise<unknown> { return this.images.create(ctx as AuthedCtx, id, body); }

  @Post('media/:id/revert') @HttpCode(200) @RequirePermissions('media.ai_edit')
  revert(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.images.revert(ctx as AuthedCtx, id); }

  @Post('generations/:id/approve') @HttpCode(200) @RequirePermissions('media.ai_edit')
  approve(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.images.approve(ctx as AuthedCtx, id); }

  @Delete('generations/:id') @RequirePermissions('media.ai_edit')
  discard(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.images.discard(ctx as AuthedCtx, id); }
}
