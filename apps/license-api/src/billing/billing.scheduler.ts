import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { BillingService } from './billing.service';

/** Rotina periódica: gera faturas automáticas e trata vencidas. Nos testes, `billing.tick()` é chamado direto. */
@Injectable()
export class BillingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BillingScheduler');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(ENV) private readonly env: Env, private readonly billing: BillingService) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), this.env.BILLING_TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.run(), 15_000).unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async run() {
    try { await this.billing.tick(); } catch (e) { this.log.error(`Falha na rotina de cobrança: ${(e as Error).message}`); }
  }
}
