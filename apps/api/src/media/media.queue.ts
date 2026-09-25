import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, Env } from '../config/env';
import { MediaProcessor } from './media.processor';

const QUEUE = 'media-processing';
const ATTEMPTS = 3;

/**
 * Fila de processamento de mídia.
 *  - Com REDIS_URL: BullMQ (retry com backoff, processamento fora do ciclo da requisição).
 *  - Sem Redis: processa em linha (mais simples para desenvolvimento).
 */
@Injectable()
export class MediaQueue implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MediaQueue');
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(@Inject(ENV) private readonly env: Env, private readonly processor: MediaProcessor) {}

  get mode() { return this.queue ? 'bullmq' : 'inline'; }

  onModuleInit() {
    if (!this.env.REDIS_URL) {
      this.log.warn('REDIS_URL não definido: mídias serão processadas em linha.');
      return;
    }
    // Prefixo por ambiente: testes e desenvolvimento nunca consomem jobs um do outro no mesmo Redis.
    const prefix = this.env.NODE_ENV === 'test' ? 'bull-test' : 'bull';
    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection, prefix });
    this.worker = new Worker(QUEUE, (job) => this.processor.process(job.data.mediaId), { connection: this.connection, prefix, concurrency: 2 });
    this.worker.on('failed', (job, err) => {
      // Só marca como falha depois da última tentativa.
      if (job && job.attemptsMade >= (job.opts.attempts ?? ATTEMPTS)) void this.processor.markFailed(job.data.mediaId, err);
    });
    this.worker.on('error', (err) => this.log.error(err.message));
  }

  async enqueue(mediaId: string) {
    if (!this.queue) {
      try { await this.processor.process(mediaId); } catch (e) { await this.processor.markFailed(mediaId, e); }
      return;
    }
    try {
      // Sem resposta do Redis em 3s, não deixamos o upload pendurado: processa em linha.
      await Promise.race([
        this.queue.add('process', { mediaId }, { attempts: ATTEMPTS, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 200, removeOnFail: 500 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis não respondeu')), 3000)),
      ]);
    } catch (e) {
      this.log.warn(`Fila indisponível (${(e as Error).message}); processando a mídia em linha.`);
      try { await this.processor.process(mediaId); } catch (err) { await this.processor.markFailed(mediaId, err); }
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
