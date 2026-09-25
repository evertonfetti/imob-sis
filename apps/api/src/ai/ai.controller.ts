import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  aiAccountSchema, aiDiscoverSchema, aiModelSchema, aiSettingsSchema, createGenerationSchema, updateAiAccountSchema, updateAiModelSchema,
  type AiAccountInput, type AiDiscoverInput, type AiModelInput, type AiSettingsInput, type CreateGenerationInput, type UpdateAiAccountInput, type UpdateAiModelInput,
} from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AiImagesService } from './ai-images.service';
import { AiSettingsService } from './ai-settings.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class AiController {
  constructor(private readonly images: AiImagesService, private readonly settings: AiSettingsService) {}

  // Contas, modelos e padrões: administração da empresa (guardam chaves pagas).
  @Get('ai/settings') @RequirePermissions('admin.company')
  getSettings(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.settings.dto(ctx.user!.companyId); }

  @Put('ai/settings') @RequirePermissions('admin.company')
  saveSettings(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(aiSettingsSchema)) body: AiSettingsInput): Promise<unknown> { return this.settings.save(ctx as AuthedCtx, body); }

  /** Lista os modelos que a chave dá acesso (sem salvar nada): o usuário escolhe quais adicionar. */
  @Post('ai/discover') @HttpCode(200) @RequirePermissions('admin.company')
  discover(@Body(new ZodPipe(aiDiscoverSchema)) body: AiDiscoverInput): Promise<unknown> { return this.settings.discover(body.provider, body.apiKey); }

  @Get('ai/accounts/:id/discover') @RequirePermissions('admin.company')
  discoverForAccount(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.settings.discoverForAccount(ctx.user!.companyId, id); }

  @Post('ai/accounts') @HttpCode(201) @RequirePermissions('admin.company')
  createAccount(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(aiAccountSchema)) body: AiAccountInput): Promise<unknown> { return this.settings.createAccount(ctx as AuthedCtx, body); }

  @Patch('ai/accounts/:id') @RequirePermissions('admin.company')
  updateAccount(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateAiAccountSchema)) body: UpdateAiAccountInput): Promise<unknown> { return this.settings.updateAccount(ctx as AuthedCtx, id, body); }

  @Delete('ai/accounts/:id') @RequirePermissions('admin.company')
  removeAccount(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.settings.removeAccount(ctx as AuthedCtx, id); }

  @Post('ai/accounts/:id/models') @HttpCode(201) @RequirePermissions('admin.company')
  addModel(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(aiModelSchema)) body: AiModelInput): Promise<unknown> { return this.settings.addModel(ctx as AuthedCtx, id, body); }

  @Patch('ai/models/:id') @RequirePermissions('admin.company')
  updateModel(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateAiModelSchema)) body: UpdateAiModelInput): Promise<unknown> { return this.settings.updateModel(ctx as AuthedCtx, id, body); }

  @Delete('ai/models/:id') @RequirePermissions('admin.company')
  removeModel(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.settings.removeModel(ctx as AuthedCtx, id); }

  // Quem edita fotos com IA vê só as opções ativas e o consumo, nunca as chaves.
  @Get('ai/status') @RequirePermissions('media.ai_edit')
  status(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.settings.status(ctx.user!.companyId); }

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
