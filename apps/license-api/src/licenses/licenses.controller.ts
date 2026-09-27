import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  heartbeatSchema, licenseInputSchema, licenseStatusInputSchema, type HeartbeatInput, type LicenseInput, type LicenseStatusInput,
} from '@imob/types';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { CurrentStaff } from '../common/request-context';
import type { AuthedStaff } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { LicensesService } from './licenses.service';

const planIdSchema = z.object({ planId: z.string().uuid() });

@Controller('licenses')
export class LicensesController {
  constructor(private readonly svc: LicensesService) {}

  @Get() list() { return this.svc.list(); }

  @Get(':id') detail(@Param('id') id: string) { return this.svc.detail(id); }

  @Post()
  create(@Body(new ZodPipe(licenseInputSchema)) body: LicenseInput, @CurrentStaff() staff: AuthedStaff) { return this.svc.create(body, staff); }

  @Post(':id/regenerate-key')
  regenerate(@Param('id') id: string, @CurrentStaff() staff: AuthedStaff) { return this.svc.regenerateKey(id, staff); }

  @Post(':id/reset-fingerprint')
  resetFingerprint(@Param('id') id: string, @CurrentStaff() staff: AuthedStaff) { return this.svc.resetFingerprint(id, staff); }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body(new ZodPipe(licenseStatusInputSchema)) body: LicenseStatusInput, @CurrentStaff() staff: AuthedStaff) {
    return this.svc.setStatus(id, body, staff);
  }

  @Patch(':id/plan')
  changePlan(@Param('id') id: string, @Body(new ZodPipe(planIdSchema)) body: { planId: string }, @CurrentStaff() staff: AuthedStaff) {
    return this.svc.changePlan(id, body.planId, staff);
  }

  // ---------- Chamado pela instalação do cliente (autenticação: a própria chave, não um funcionário) ----------
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Headers('x-license-key') key: string | undefined, @Body(new ZodPipe(heartbeatSchema)) body: HeartbeatInput) {
    if (!key) throw new UnauthorizedException();
    return this.svc.heartbeat(key, body);
  }
}
