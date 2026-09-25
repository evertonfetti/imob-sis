import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { ProposalsService } from './proposals.service';

/** Verifica periodicamente propostas com validade vencida. Nos testes, `expireDue()` é chamado direto. */
@Injectable()
export class CommercialScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CommercialScheduler');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(ENV) private readonly env: Env, private readonly proposals: ProposalsService) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), this.env.COMMERCIAL_TICK_MS);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async run() {
    try { await this.proposals.expireDue(); } catch (e) { this.log.error(`Falha ao expirar propostas: ${(e as Error).message}`); }
  }
}
