import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  publicLeadSchema, publicListSchema, whatsappClickSchema,
  type PublicLeadInput, type PublicListQuery, type WhatsappClickInput,
} from '@imob/types';
import { Public } from '../common/decorators';
import { Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { PublicService } from './public.service';

/**
 * API do site público (sem login).
 * Leituras não têm rate limit por IP: quem chama é o servidor do site (um IP só) e o site faz cache.
 * Escritas (formulário, clique no WhatsApp) vêm do navegador do visitante e são limitadas.
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @SkipThrottle() @Get('company')
  company() { return this.svc.getCompany(); }

  @SkipThrottle() @Get('properties')
  list(@Query(new ZodPipe(publicListSchema)) q: PublicListQuery) { return this.svc.list(q); }

  @SkipThrottle() @Get('properties/:slug')
  detail(@Param('slug') slug: string) { return this.svc.detail(slug); }

  @SkipThrottle() @Get('filters')
  filters() { return this.svc.filters(); }

  @SkipThrottle() @Get('sitemap')
  sitemap() { return this.svc.sitemap(); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('leads') @HttpCode(201)
  lead(@Body(new ZodPipe(publicLeadSchema)) body: PublicLeadInput, @Ctx() ctx: ReqCtx) {
    return this.svc.createLead(body, ctx);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('whatsapp-click') @HttpCode(204)
  async click(@Body(new ZodPipe(whatsappClickSchema)) body: WhatsappClickInput) {
    await this.svc.whatsappClick(body);
  }
}
