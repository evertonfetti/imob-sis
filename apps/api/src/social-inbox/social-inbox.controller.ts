import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { Public } from '../common/decorators';
import { AppException } from '../common/app-exception';
import { SocialInboxService } from './social-inbox.service';

/**
 * Webhooks da Meta para o inbox do Messenger e do Instagram Direct. Ficam fora de /api/v1, como o do WhatsApp
 * (apps/whatsapp/whatsapp.controllers.ts) — é a Meta quem chama, com a URL cadastrada no painel de desenvolvedores.
 */
@Public()
@SkipThrottle()
@Controller('webhooks/meta/messenger')
export class MessengerWebhookController {
  constructor(private readonly inbox: SocialInboxService) {}

  @Get()
  async verify(@Query() q: Record<string, string>) {
    if (await this.inbox.verify(q['hub.mode'], q['hub.verify_token'])) return q['hub.challenge'] ?? '';
    throw new AppException('WEBHOOK_SIGNATURE_INVALID', 403);
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: FastifyRequest, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: Record<string, unknown>) {
    await this.inbox.processWebhook('FACEBOOK', body ?? {}, (req as unknown as { rawBody?: Buffer }).rawBody, signature);
    return { ok: true };
  }
}

@Public()
@SkipThrottle()
@Controller('webhooks/meta/instagram')
export class InstagramWebhookController {
  constructor(private readonly inbox: SocialInboxService) {}

  @Get()
  async verify(@Query() q: Record<string, string>) {
    if (await this.inbox.verify(q['hub.mode'], q['hub.verify_token'])) return q['hub.challenge'] ?? '';
    throw new AppException('WEBHOOK_SIGNATURE_INVALID', 403);
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: FastifyRequest, @Headers('x-hub-signature-256') signature: string | undefined, @Body() body: Record<string, unknown>) {
    await this.inbox.processWebhook('INSTAGRAM', body ?? {}, (req as unknown as { rawBody?: Buffer }).rawBody, signature);
    return { ok: true };
  }
}
