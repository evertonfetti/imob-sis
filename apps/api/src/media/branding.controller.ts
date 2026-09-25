import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { logoConfirmSchema, logoUploadSchema, watermarkSettingsSchema, type LogoUploadInput, type UpdateWatermarkInput } from '@imob/types';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { BrandingService } from './branding.service';

const origin = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}`;

@Controller('company')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get('watermark') @RequirePermissions('admin.company')
  get(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.branding.get(ctx.user!.companyId); }

  @Patch('watermark') @RequirePermissions('admin.company')
  update(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(watermarkSettingsSchema)) body: UpdateWatermarkInput): Promise<unknown> { return this.branding.update(ctx as AuthedCtx, body); }

  @Post('watermark/apply') @HttpCode(200) @RequirePermissions('admin.company')
  apply(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.branding.applyToExisting(ctx as AuthedCtx); }

  @Post('logo/upload-url') @HttpCode(200) @RequirePermissions('admin.company')
  uploadUrl(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest, @Body(new ZodPipe(logoUploadSchema)) body: LogoUploadInput): Promise<unknown> { return this.branding.createLogoUpload(ctx.user!.companyId, body, origin(req)); }

  @Post('logo') @HttpCode(200) @RequirePermissions('admin.company')
  confirm(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(logoConfirmSchema)) body: { key: string }): Promise<unknown> { return this.branding.confirmLogo(ctx as AuthedCtx, body.key); }

  @Delete('logo') @RequirePermissions('admin.company')
  remove(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.branding.removeLogo(ctx as AuthedCtx); }
}
