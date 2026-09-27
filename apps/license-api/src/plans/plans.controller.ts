import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { planInputSchema, type PlanInput } from '@imob/types';
import { ZodPipe } from '../common/zod.pipe';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly svc: PlansService) {}

  @Get() list() { return this.svc.list(); }

  @Post()
  create(@Body(new ZodPipe(planInputSchema)) body: PlanInput) { return this.svc.create(body); }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(planInputSchema.partial())) body: Partial<PlanInput>) { return this.svc.update(id, body); }

  @Delete(':id') @HttpCode(204)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
