import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  createPropertySchema, importConfirmSchema, importUploadSchema, listPropertiesSchema, updatePropertySchema,
  type CreatePropertyInput, type ImportConfirmInput, type ImportUploadInput, type ListPropertiesQuery, type UpdatePropertyInput,
} from '@imob/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { PropertiesImportExportService } from './properties-import-export.service';
import { PropertiesService } from './properties.service';

const uuid = new ParseUUIDPipe();
const origin = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly props: PropertiesService, private readonly importExport: PropertiesImportExportService) {}

  @Get()
  @RequirePermissions('property.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listPropertiesSchema)) q: ListPropertiesQuery): Promise<unknown> {
    return this.props.list(ctx.user!, q);
  }

  @Get('summary')
  @RequirePermissions('property.view')
  summary(@Ctx() ctx: ReqCtx): Promise<unknown> {
    return this.props.summary(ctx.user!.companyId);
  }

  @Get('options')
  @RequirePermissions('property.view')
  options(@Ctx() ctx: ReqCtx): Promise<unknown> {
    return this.props.options(ctx.user!.companyId);
  }

  @Post()
  @RequirePermissions('property.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createPropertySchema)) body: CreatePropertyInput): Promise<unknown> {
    return this.props.create(ctx as AuthedCtx, body);
  }

  // ---------- Importar / exportar em planilha ----------
  @Get('export')
  @RequirePermissions('property.view')
  async export(@Ctx() ctx: ReqCtx, @Res() reply: FastifyReply) {
    const buf = await this.importExport.export(ctx.user!.companyId);
    reply.header('content-type', XLSX).header('content-disposition', 'attachment; filename="imoveis.xlsx"').send(buf);
  }

  @Get('import/template')
  @RequirePermissions('property.view')
  async importTemplate(@Res() reply: FastifyReply) {
    const buf = await this.importExport.template();
    reply.header('content-type', XLSX).header('content-disposition', 'attachment; filename="modelo-imoveis.xlsx"').send(buf);
  }

  @Post('import/upload-url')
  @HttpCode(200)
  @RequirePermissions('property.create')
  importUploadUrl(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest, @Body(new ZodPipe(importUploadSchema)) body: ImportUploadInput): Promise<unknown> {
    return this.importExport.createUpload(ctx.user!.companyId, body, origin(req));
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('property.create')
  import(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(importConfirmSchema)) body: ImportConfirmInput): Promise<unknown> {
    return this.importExport.import(ctx as AuthedCtx, body);
  }

  @Get(':id')
  @RequirePermissions('property.view')
  get(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.props.get(ctx.user!, id);
  }

  @Get(':id/history')
  @RequirePermissions('property.edit')
  history(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.props.history(ctx.user!, id);
  }

  @Patch(':id')
  @RequirePermissions('property.edit')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updatePropertySchema)) body: UpdatePropertyInput): Promise<unknown> {
    return this.props.update(ctx as AuthedCtx, id, body);
  }

  @Delete(':id')
  @RequirePermissions('property.delete')
  @HttpCode(204)
  async remove(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) {
    await this.props.remove(ctx as AuthedCtx, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('property.publish')
  publish(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.props.publish(ctx as AuthedCtx, id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermissions('property.publish')
  unpublish(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.props.unpublish(ctx as AuthedCtx, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('property.archive')
  archive(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> {
    return this.props.archive(ctx as AuthedCtx, id);
  }
}
