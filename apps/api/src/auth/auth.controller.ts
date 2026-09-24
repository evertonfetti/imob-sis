import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  type LoginInput,
  type ResetPasswordInput,
} from '@imob/types';
import { z } from 'zod';
import { Public } from '../common/decorators';
import { AuthedUser, Ctx, CurrentUser, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, toAuthUser } from './auth.service';

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
  async logout(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Ctx() ctx: ReqCtx) {
    await this.auth.logout(body.refreshToken, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>, @Ctx() ctx: ReqCtx) {
    await this.auth.forgotPassword(body.email, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput, @Ctx() ctx: ReqCtx) {
    await this.auth.resetPassword(body.token, body.password, ctx);
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser) {
    return toAuthUser(user);
  }
}
