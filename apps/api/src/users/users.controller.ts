import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createUserSchema,
  paginationSchema,
  updateUserSchema,
  type CreateUserInput,
  type Pagination,
  type UpdateUserInput,
} from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';

@Controller('users')
@RequirePermissions('admin.users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(paginationSchema)) q: Pagination) {
    return this.users.list(ctx.user!.companyId, q);
  }

  @Post()
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createUserSchema)) body: CreateUserInput) {
    return this.users.create(ctx as AuthedCtx, body);
  }

  @Get(':id')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(ctx.user!.companyId, id);
  }

  @Patch(':id')
  update(
    @Ctx() ctx: ReqCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    return this.users.update(ctx as AuthedCtx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.deactivate(ctx as AuthedCtx, id);
  }
}
