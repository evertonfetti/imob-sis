import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  integrationSchema, listConversationsSchema, sendMessageSchema,
  type IntegrationInput, type SendMessageInput,
} from '@imob/types';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public, RequirePermissions } from '../common/decorators';
import { AuthedCtx, Ctx, ReqCtx } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AppException } from '../common/app-exception';
import { IntegrationsService } from './integrations.service';
import { WhatsappService } from './whatsapp.service';

const uuid = new ParseUUIDPipe();
const c = (ctx: ReqCtx) => ctx as AuthedCtx;

/** Webhook da Meta. Fica em /webhooks/meta/whatsapp (fora de /api/v1), como a spec define. */
@Public()
@SkipThrottle()
@Controller('webhooks/meta/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly wa: WhatsappService, private readonly integrations: IntegrationsService) {}

  /** Verificação inicial: a Meta chama com hub.challenge e o token que você configurou. */
  @Get()
  async verify(@Query() q: Record<string, string>) {
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] && (await this.integrations.verifyTokenExists(q['hub.verify_token']))) {
      return q['hub.challenge'] ?? '';
    }
    throw new AppException('WEBHOOK_SIGNATURE_INVALID', 403);
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: FastifyRequest, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: Record<string, unknown>) {
    await this.wa.processWebhook(body ?? {}, (req as unknown as { rawBody?: Buffer }).rawBody, signature);
    return { ok: true };
  }
}

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly wa: WhatsappService) {}

  @Get() @RequirePermissions('lead.view')
  list(@Ctx() ctx: ReqCtx, @Query(new ZodPipe(listConversationsSchema)) q: z.infer<typeof listConversationsSchema>): Promise<unknown> { return this.wa.list(ctx.user!, q); }

  @Get('unread') @RequirePermissions('lead.view')
  unread(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.wa.unreadTotal(ctx.user!); }

  @Get(':id') @RequirePermissions('lead.view')
  get(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.wa.get(ctx.user!, id); }

  @Post(':id/read') @HttpCode(200) @RequirePermissions('lead.view')
  read(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.wa.markRead(ctx.user!, id); }

  @Post(':id/messages') @RequirePermissions('lead.edit')
  send(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string, @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput): Promise<unknown> { return this.wa.send(c(ctx), id, body); }
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly wa: WhatsappService) {}

  @Post(':id/retry') @HttpCode(200) @RequirePermissions('lead.edit')
  retry(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.wa.retry(c(ctx), id); }

  @Get(':id/media') @RequirePermissions('lead.view')
  media(@Ctx() ctx: ReqCtx, @Param('id', uuid) id: string): Promise<unknown> { return this.wa.media(ctx.user!, id); }
}

@Controller('integrations/whatsapp')
@RequirePermissions('admin.company')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  private origin(req: FastifyRequest) { return `${req.protocol}://${req.host}`; }

  @Get()
  status(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest): Promise<unknown> { return this.svc.status(ctx.user!.companyId, this.origin(req)); }

  @Put()
  async save(@Ctx() ctx: ReqCtx, @Req() req: FastifyRequest, @Body(new ZodPipe(integrationSchema)) body: IntegrationInput): Promise<unknown> {
    await this.svc.save(c(ctx), body);
    return this.svc.status(ctx.user!.companyId, this.origin(req));
  }

  @Post('test') @HttpCode(200)
  test(@Ctx() ctx: ReqCtx): Promise<unknown> { return this.svc.test(c(ctx)); }

  @Delete() @HttpCode(204)
  async remove(@Ctx() ctx: ReqCtx) { await this.svc.remove(c(ctx)); }
}
