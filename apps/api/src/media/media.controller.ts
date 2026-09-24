import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import {
  confirmMediaSchema, orderMediaSchema, updateMediaSchema, uploadUrlSchema,
  type ConfirmMediaInput, type UpdateMediaInput, type UploadUrlInput,
} from '@imob/types';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { Inject } from '@nestjs/common';
import { MediaService } from './media.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService, @Inject(ENV) private readonly env: Env) {}

  @Get('properties/:id/media')
  @RequirePermissions('media.view')
  list(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.media.list(ctx.user!, id);
  }

  @Post('properties/:id/media/upload-url')
  @HttpCode(200)
  @RequirePermissions('media.upload')
  uploadUrl(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest, @Param('id', uuid) id: string, @Body(new ZodPipe(uploadUrlSchema)) body: UploadUrlInput): Promise<unknown> {
    const origin = this.env.API_PUBLIC_URL ?? `${req.protocol}://${req.host}`;
    return this.media.createUploadUrl(ctx.user!, id, body, origin);
  }

  @Post('properties/:id/media')
  @RequirePermissions('media.upload')
  confirm(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(confirmMediaSchema)) body: ConfirmMediaInput): Promise<unknown> {
    return this.media.confirm(ctx as AuthedCtx, id, body);
  }

  @Patch('properties/:id/media/order')
  @RequirePermissions('media.upload')
  reorder(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(orderMediaSchema)) body: z.infer<typeof orderMediaSchema>): Promise<unknown> {
    return this.media.reorder(ctx as AuthedCtx, id, body.ids);
  }

  @Patch('media/:id')
  @RequirePermissions('media.upload')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateMediaSchema)) body: UpdateMediaInput): Promise<unknown> {
    return this.media.update(ctx as AuthedCtx, id, body);
  }

  @Post('media/:id/reprocess')
  @HttpCode(200)
  @RequirePermissions('media.upload')
  reprocess(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.media.reprocess(ctx as AuthedCtx, id);
  }

  @Delete('media/:id')
  @HttpCode(204)
  @RequirePermissions('media.delete')
  async remove(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) {
    await this.media.remove(ctx as AuthedCtx, id);
  }
}
