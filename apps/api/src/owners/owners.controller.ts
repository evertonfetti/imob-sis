import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ownerSchema, paginationSchema, updateOwnerSchema, type OwnerInput, type Pagination } from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { OwnersService } from './owners.service';

// Dados de proprietários (documento, contato) só para quem edita imóveis.
@Controller('owners')
@RequirePermissions('property.edit')
export class OwnersController {
  constructor(private readonly owners: OwnersService) {}

  @Get()
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(paginationSchema)) q: Pagination): Promise<unknown> {
    return this.owners.list(ctx.user!.companyId, q);
  }

  @Post()
  @RequirePermissions('property.create')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(ownerSchema)) body: OwnerInput): Promise<unknown> {
    return this.owners.create(ctx as AuthedCtx, body);
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
