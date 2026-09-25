import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  activateAccountsSchema, createSocialPostSchema, listSocialPostsSchema, socialAppSchema, updateSocialPostSchema,
  type CreateSocialPostInput, type SocialAppInput, type UpdateSocialPostInput,
} from '@imob/types';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Public, RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { Inject } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { SocialAccountsService } from './social-accounts.service';
import { SocialPostsService } from './social-posts.service';

const uuid = new ParseUUIDPipe();
const c = (ctx: ReqCtx) => ctx as AuthedCtx;

@Controller('social')
export class SocialController {
  constructor(
    private readonly accounts: SocialAccountsService,
    private readonly posts: SocialPostsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------- Login com o Facebook ----------
  @Post('connect') @HttpCode(200) @RequirePermissions('marketing.manage')
  connect(@Ctx() ctx: ReqCtx) { return this.accounts.connectUrl(c(ctx)); }

  /** Retorno do Facebook: público (o navegador vem de outro site), protegido pelo `state` assinado. */
  @Public() @SkipThrottle() @Get('oauth/callback')
  async callback(@Query() q: { code?: string; state?: string; error?: string }, @Res() reply: FastifyReply) {
    const status = await this.accounts.handleCallback(q);
    return reply.status(302).header('location', `${this.env.ADMIN_URL.replace(/\/$/, '')}/redes-sociais?aba=contas&status=${status}`).send();
  }

  // ---------- Aplicativo Meta desta empresa ----------
  @Put('app') @RequirePermissions('marketing.manage')
  saveApp(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(socialAppSchema)) body: SocialAppInput): Promise<unknown> { return this.accounts.saveApp(c(ctx), body); }

  @Delete('app') @HttpCode(204) @RequirePermissions('marketing.manage')
  async removeApp(@Ctx() ctx: ReqCtx) { await this.accounts.removeApp(c(ctx)); }

  @Get('accounts') @RequirePermissions('marketing.view')
  list(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.accounts.list(ctx.user!.companyId); }

  @Post('accounts/activate') @HttpCode(200) @RequirePermissions('marketing.manage')
  activate(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(activateAccountsSchema)) body: z.infer<typeof activateAccountsSchema>): Promise<unknown> { return this.accounts.activate(c(ctx), body.accountIds); }

  @Post('accounts/:id/check') @HttpCode(200) @RequirePermissions('marketing.manage')
  check(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.accounts.check(c(ctx), id); }

  @Delete('accounts/:id') @HttpCode(204) @RequirePermissions('marketing.manage')
  async remove(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) { await this.accounts.remove(c(ctx), id); }

  // ---------- Publicações ----------
  @Get('composer/:propertyId') @RequirePermissions('marketing.manage')
  composer(@Ctx() ctx: ReqCtx, @Param('propertyId', uuid) id: string): Promise<unknown> { return this.posts.composer(ctx.user!, id); }

  @Get('posts') @RequirePermissions('marketing.view')
  listPosts(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listSocialPostsSchema)) q: z.infer<typeof listSocialPostsSchema>): Promise<unknown> { return this.posts.list(ctx.user!, q); }

  @Get('posts/:id') @RequirePermissions('marketing.view')
  getPost(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.posts.get(ctx.user!, id); }

  @Post('posts') @RequirePermissions('marketing.manage')
  create(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(createSocialPostSchema)) body: CreateSocialPostInput): Promise<unknown> { return this.posts.create(c(ctx), body); }

  @Patch('posts/:id') @RequirePermissions('marketing.manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateSocialPostSchema)) body: UpdateSocialPostInput): Promise<unknown> { return this.posts.update(c(ctx), id, body); }

  @Post('posts/:id/cancel') @HttpCode(200) @RequirePermissions('marketing.manage')
  cancel(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.posts.cancel(c(ctx), id); }

  @Post('posts/:id/publish-now') @HttpCode(200) @RequirePermissions('marketing.manage')
  publishNow(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.posts.publishNow(c(ctx), id); }

  @Post('posts/:id/targets/:targetId/retry') @HttpCode(200) @RequirePermissions('marketing.manage')
  retry(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Param('targetId', uuid) targetId: string): Promise<unknown> { return this.posts.retryTarget(c(ctx), id, targetId); }
}
