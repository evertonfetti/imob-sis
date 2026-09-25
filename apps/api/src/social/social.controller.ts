import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  activateAccountsSchema, createSocialPostSchema, listSocialPostsSchema, connectSocialSchema, shareSchema, socialAppSchema, updateSocialAppSchema, updateSocialPostSchema,
  type ConnectSocialInput, type CreateSocialPostInput, type SocialAppInput, type UpdateSocialAppInput, type UpdateSocialPostInput,
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
  connect(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(connectSocialSchema)) body: ConnectSocialInput) { return this.accounts.connectUrl(c(ctx), body.appId); }

  /** Retorno do Facebook: público (o navegador vem de outro site), protegido pelo `state` assinado. */
  @Public() @SkipThrottle() @Get('oauth/callback')
  async callback(@Query() q: { code?: string; state?: string; error?: string }, @Res() reply: FastifyReply) {
    const status = await this.accounts.handleCallback(q);
    return reply.status(302).header('location', `${this.env.ADMIN_URL.replace(/\/$/, '')}/redes-sociais?aba=contas&status=${status}`).send();
  }

  // ---------- Aplicativos da Meta desta empresa ----------
  @Post('apps') @RequirePermissions('marketing.manage')
  createApp(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(socialAppSchema)) body: SocialAppInput): Promise<unknown> { return this.accounts.createApp(c(ctx), body); }

  @Patch('apps/:id') @RequirePermissions('marketing.manage')
  updateApp(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(updateSocialAppSchema)) body: UpdateSocialAppInput): Promise<unknown> { return this.accounts.updateApp(c(ctx), id, body); }

  @Delete('apps/:id') @HttpCode(204) @RequirePermissions('marketing.manage')
  async removeApp(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string) { await this.accounts.removeApp(c(ctx), id); }

  @Get('accounts') @RequirePermissions('marketing.view')
  list(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.accounts.list(ctx.user!); }

  @Post('accounts/activate') @HttpCode(200) @RequirePermissions('marketing.manage')
  activate(@Ctx() ctx: ReqCtx, @Body(new ZodPipe(activateAccountsSchema)) body: z.infer<typeof activateAccountsSchema>): Promise<unknown> { return this.accounts.activate(c(ctx), body.accountIds); }

  @Patch('accounts/:id/share') @RequirePermissions('marketing.manage')
  share(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(shareSchema)) body: { shared: boolean }): Promise<unknown> { return this.accounts.setShared(c(ctx), id, body.shared); }

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
