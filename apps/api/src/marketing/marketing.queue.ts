import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ModuleRef } from '@nestjs/core';
import { ENV, Env } from '../config/env';
import { MarketingService } from './marketing.service';

const QUEUE = 'marketing-events';
const ATTEMPTS = 3;

/** Fila de envio à Meta: nunca bloqueia quem gerou o evento; tenta até 3 vezes com espera crescente. */
@Injectable()
export class MarketingQueue implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MarketingQueue');
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  // ModuleRef evita a dependência circular com MarketingService (que também enfileira).
  constructor(@Inject(ENV) private readonly env: Env, private readonly moduleRef: ModuleRef) {}

  private get service() { return this.moduleRef.get(MarketingService, { strict: false }); }

  onModuleInit() {
    if (!this.env.REDIS_URL) { this.log.warn('REDIS_URL não definido: eventos serão enviados em linha (sem novas tentativas automáticas).'); return; }
    const prefix = this.env.NODE_ENV === 'test' ? 'bull-test' : 'bull';
    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.worker = new Worker(QUEUE, (job) => this.service.process(job.data.id), { connection: this.connection, prefix, concurrency: 3 });
    this.worker.on('failed', (job, err) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? ATTEMPTS)) void this.service.markFailed(job.data.id, err);
    });
    this.worker.on('error', (err) => this.log.error(err.message));
  }

  async enqueue(id: string) {
    if (this.queue) {
      try {
        await Promise.race([
          this.queue.add('send', { id }, { attempts: ATTEMPTS, backoff: { type: 'exponential', delay: this.env.MARKETING_RETRY_DELAY_MS }, removeOnComplete: 500, removeOnFail: 1000 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis não respondeu')), 3000)),
        ]);
        return;
      } catch (e) {
        this.log.warn(`Fila indisponível (${(e as Error).message}); enviando em linha.`);
      }
    }
    try { await this.service.process(id); } catch (e) { await this.service.markFailed(id, e); }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
