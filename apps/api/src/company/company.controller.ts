import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Company } from '@imob/database';
import {
  branchSchema,
  updateBranchSchema,
  updateCompanySchema,
  type BranchInput,
  type UpdateCompanyInput,
} from '@imob/types';
import { RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { CompanyService } from './company.service';

@Controller()
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  // Leitura liberada a qualquer usuário autenticado (nome/cores/filiais alimentam a interface).
  @Get('company')
  get(@Ctx() ctx: ReqCtx): Promise<Company> {
    return this.company.get(ctx.user!.companyId);
  }

  @Patch('company')
  @RequirePermissions('admin.company')
  update(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(updateCompanySchema)) body: UpdateCompanyInput) {
    return this.company.update(ctx as AuthedCtx, body);
  }

  @Get('branches')
  branches(@Ctx() ctx: ReqCtx) {
    return this.company.listBranches(ctx.user!.companyId);
  }

  @Post('branches')
  @RequirePermissions('admin.branch')
  createBranch(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(branchSchema)) body: BranchInput) {
    return this.company.createBranch(ctx as AuthedCtx, body);
  }

  @Patch('branches/:id')
  @RequirePermissions('admin.branch')
  updateBranch(
    @Ctx() ctx: ReqCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateBranchSchema)) body: Partial<BranchInput>,
  ) {
    return this.company.updateBranch(ctx as AuthedCtx, id, body);
  }
}
