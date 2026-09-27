import { Module } from '@nestjs/common';
import { BillingScheduler } from './billing.scheduler';
import { BillingService } from './billing.service';
import { MercadoPagoClient } from './mercadopago.client';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [WebhooksController],
  providers: [MercadoPagoClient, BillingService, BillingScheduler],
  exports: [BillingService],
})
export class BillingModule {}
