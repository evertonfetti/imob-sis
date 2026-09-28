import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import {
  importConfirmSchema, importUploadSchema, ownerSchema, paginationSchema, updateOwnerSchema,
  type ImportConfirmInput, type ImportUploadInput, type OwnerInput, type Pagination,
} from '@imob/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { OwnersImportExportService } from './owners-import-export.service';
import { OwnersService } from './owners.service';

const origin = (req: FastifyRequest) => `${req.protocol}://${req.headers.host}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Dados de proprietários (documento, contato) só para quem edita imóveis.
@Controller('owners')
@RequirePermissions('property.edit')
export class OwnersController {
  constructor(private readonly owners: OwnersService, private readonly importExport: OwnersImportExportService) {}

  @Get()
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(paginationSchema)) q: Pagination): Promise<unknown> {
    return this.owners.list(ctx.user!.companyId, q);
  }

  @Post()
  @RequirePermissions('property.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(ownerSchema)) body: OwnerInput): Promise<unknown> {
    return this.owners.create(ctx as AuthedCtx, body);
  }

  // ---------- Importar / exportar em planilha ----------
  @Get('export')
  async export(@Ctx() ctx: ReqCtx, @Res() reply: FastifyReply) {
    const buf = await this.importExport.export(ctx.user!.companyId);
    reply.header('content-type', XLSX).header('content-disposition', 'attachment; filename="proprietarios.xlsx"').send(buf);
  }

  @Get('import/template')
  async importTemplate(@Res() reply: FastifyReply) {
    const buf = await this.importExport.template();
    reply.header('content-type', XLSX).header('content-disposition', 'attachment; filename="modelo-proprietarios.xlsx"').send(buf);
  }

  @Post('import/upload-url') @HttpCode(200)
  @RequirePermissions('property.create')
  importUploadUrl(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest, @Body(new ZodPipe(importUploadSchema)) body: ImportUploadInput): Promise<unknown> {
    return this.importExport.createUpload(ctx.user!.companyId, body, origin(req));
  }

  @Post('import') @HttpCode(200)
  @RequirePermissions('property.create')
  import(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(importConfirmSchema)) body: ImportConfirmInput): Promise<unknown> {
    return this.importExport.import(ctx as AuthedCtx, body);
  }

  @Get(':id')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.owners.get(ctx.user!.companyId, id);
  }

  @Patch(':id')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateOwnerSchema)) body: Partial<OwnerInput>): Promise<unknown> {
    return this.owners.update(ctx as AuthedCtx, id, body);
  }

  @Delete(':id')
  @RequirePermissions('property.delete')
  @HttpCode(204)
  async remove(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.owners.remove(ctx as AuthedCtx, id);
  }
}
