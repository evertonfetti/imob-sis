import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createPropertySchema, listPropertiesSchema, updatePropertySchema,
  type CreatePropertyInput, type ListPropertiesQuery, type UpdatePropertyInput,
} from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { PropertiesService } from './properties.service';

const uuid = new ParseUUIDPipe();

@Controller('properties')
export class PropertiesController {
  constructor(private readonly props: PropertiesService) {}

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
