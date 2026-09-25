import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TasksService } from '../crm/tasks.service';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ALERT_LIMITS } from './alerts.service';
import { LeadScoreService } from './lead-score.service';

const DAY = 86_400_000;

/** Rotinas periódicas: completa scores pendentes e cria a tarefa de retomada de leads parados. Nos testes, `tick()` é chamado direto. */
@Injectable()
export class IntelligenceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('IntelligenceScheduler');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly score: LeadScoreService, private readonly tasks: TasksService) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), this.env.INTELLIGENCE_TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 15_000).unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(): Promise<{ scored: number; retomadas: number }> {
    if (this.running) return { scored: 0, retomadas: 0 };
    this.running = true;
    try {
      let scored = 0;
      for (let n = await this.score.backfill(); n > 0 && scored < 5000; n = await this.score.backfill()) scored += n;
      return { scored, retomadas: await this.staleLeads() };
    } catch (e) {
      this.log.error(`Falha na rotina: ${(e as Error).message}`);
      return { scored: 0, retomadas: 0 };
    } finally { this.running = false; }
  }

  /** Lead em aberto, com responsável, parado há mais de N dias: uma tarefa de retomada por "período parado" (não repete a cada ciclo). */
  async staleLeads(now = new Date()): Promise<number> {
    const first = await this.prisma.pipelineStage.findMany({ where: { position: 0 }, select: { id: true } });
    const leads = await this.prisma.lead.findMany({
      where: { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] }, brokerId: { not: null }, stageEnteredAt: { lt: new Date(now.getTime() - ALERT_LIMITS.staleDays * DAY) }, ...(first.length && { stageId: { notIn: first.map((s) => s.id) } }) },
      select: { id: true, companyId: true, brokerId: true, stageEnteredAt: true, customer: { select: { name: true } }, stage: { select: { name: true } } }, take: 100,
    });
    let created = 0;
    for (const l of leads) {
      const days = Math.floor((now.getTime() - l.stageEnteredAt.getTime()) / DAY);
      const t = await this.tasks.createSystemOnce({
        companyId: l.companyId, leadId: l.id, assignedUserId: l.brokerId, title: `Retomar contato com ${l.customer.name} (parado há ${days} dias em “${l.stage?.name ?? 'etapa'}”)`,
        type: 'FOLLOW_UP', priority: 'MEDIUM', dueAt: new Date(now.getTime() + 4 * 3_600_000), ref: `stale:${l.id}:${l.stageEnteredAt.getTime()}`,
      });
      if (t) created++;
    }
    return created;
  }
}
