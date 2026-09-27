import { Controller, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { BillingService } from './billing.service';

@Controller('webhooks/mercadopago')
export class WebhooksController {
  constructor(private readonly billing: BillingService) {}

  /**
   * O Mercado Pago manda o id do pagamento na query (`data.id`) e, dependendo da configuração, também no
   * corpo. A assinatura (cabeçalho x-signature) é validada dentro do serviço antes de qualquer outra coisa.
   */
  @Public()
  @Post()
  @HttpCode(200)
  receive(
    @Query('data.id') dataId: string | undefined,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
  ) {
    return this.billing.handleWebhook(dataId, { xSignature, xRequestId });
  }
}
