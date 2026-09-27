import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, refreshSchema, type LoginInput } from '@imob/types';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { Ctx, CurrentStaff, ReqCtx } from '../common/request-context';
import type { AuthedStaff } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Ctx() ctx: ReqCtx) {
    return this.auth.login(body.email, body.password, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Ctx() ctx: ReqCtx) {
    return this.auth.refresh(body.refreshToken, ctx);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentStaff() staff: AuthedStaff) {
    return staff;
  }
}
