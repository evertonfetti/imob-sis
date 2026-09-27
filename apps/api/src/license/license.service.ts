import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { HeartbeatResponse, LicenseStatus, PlanLimits, UsageCounts } from '@imob/types';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Estado em memória, consultado a cada requisição (barato) — a versão persistida no banco é só para sobreviver a reinícios. */
export interface LicenseState {
  ok: boolean;
  status: LicenseStatus | 'DISABLED';
  planName: string | null;
  limits: PlanLimits;
  message: string | null;
}

const APP_VERSION = process.env.npm_package_version ?? 'dev';

/**
 * Bloco 11 (SaaS) — Fase 1. Sem LICENSE_SERVER_URL configurado, fica desativado (sempre liberado): é o caso
 * de toda instalação atual e de quem roda o sistema sem licenciamento. Confira o manual de implantação.
 */
@Injectable()
export class LicenseService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LicenseService.name);
  private timer?: NodeJS.Timeout;
  private state: LicenseState = { ok: true, status: 'DISABLED', planName: null, limits: {}, message: null };

  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  get enabled() {
    return !!(this.env.LICENSE_SERVER_URL && this.env.LICENSE_KEY);
  }

  getState(): LicenseState {
    return this.state;
  }

  isBlocked(): boolean {
    return this.enabled && !this.state.ok;
  }

  async onModuleInit() {
    if (!this.enabled) return;
    const row = await this.prisma.licenseState.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
    this.state = {
      ok: row.ok, status: row.status as LicenseStatus, planName: row.planName, limits: (row.limits ?? {}) as PlanLimits, message: row.message,
    };
    // Primeira confirmação logo na subida (o estado já sai correto antes de servir a primeira requisição) e depois a cada LICENSE_CHECK_INTERVAL_MS.
    await this.check();
    this.timer = setInterval(() => void this.check(), this.env.LICENSE_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async counts(): Promise<UsageCounts> {
    const [users, properties, branches, socialAccounts, aiAccounts] = await Promise.all([
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.property.count({ where: { status: { not: 'ARCHIVED' } } }),
      this.prisma.branch.count(),
      this.prisma.socialAccount.count({ where: { status: 'ACTIVE' } }),
      this.prisma.aiAccount.count({ where: { active: true } }),
    ]);
    return { users, properties, branches, socialAccounts, aiAccounts };
  }

  private async fingerprint(): Promise<string> {
    const row = await this.prisma.licenseState.findUnique({ where: { id: 'singleton' } });
    if (row?.fingerprint) return row.fingerprint;
    const fingerprint = randomUUID();
    await this.prisma.licenseState.update({ where: { id: 'singleton' }, data: { fingerprint } });
    return fingerprint;
  }

  private async persist(patch: Partial<{ status: string; ok: boolean; planName: string | null; limits: PlanLimits; message: string | null; lastCheckedAt: Date; lastOkAt: Date }>) {
    await this.prisma.licenseState.update({ where: { id: 'singleton' }, data: patch as never });
  }

  /** Confirma com o servidor de licenças. Sem resposta, aplica o prazo de tolerância antes de bloquear. */
  async check(): Promise<void> {
    if (!this.enabled) return;
    const now = new Date();
    try {
      const res = await fetch(`${this.env.LICENSE_SERVER_URL!.replace(/\/$/, '')}/v1/licenses/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-license-key': this.env.LICENSE_KEY! },
        body: JSON.stringify({ instanceFingerprint: await this.fingerprint(), version: APP_VERSION, instanceUrl: this.env.API_PUBLIC_URL ?? null, counts: await this.counts() }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 401 || res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        this.state = { ok: false, status: 'SUSPENDED', planName: this.state.planName, limits: this.state.limits, message: body.message ?? 'Chave de licença inválida.' };
        await this.persist({ status: 'SUSPENDED', ok: false, message: this.state.message, lastCheckedAt: now });
        this.log.warn(`Licença rejeitada pelo servidor (${res.status}): ${this.state.message}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as HeartbeatResponse;
      this.state = { ok: body.ok, status: body.status, planName: body.planName, limits: body.limits, message: body.message };
      await this.persist({ status: body.status, ok: body.ok, planName: body.planName, limits: body.limits, message: body.message, lastCheckedAt: now, lastOkAt: now });
    } catch (e) {
      // Sem contato com o servidor (rede fora, servidor de licenças indisponível): mantém funcionando durante o prazo de tolerância.
      const row = await this.prisma.licenseState.findUnique({ where: { id: 'singleton' } });
      const since = row?.lastOkAt ?? row?.createdAt ?? now;
      const staleMs = now.getTime() - since.getTime();
      const graceMs = this.env.LICENSE_GRACE_DAYS * 86_400_000;
      if (staleMs > graceMs) {
        const message = `Não foi possível confirmar a licença há mais de ${this.env.LICENSE_GRACE_DAYS} dias.${this.env.LICENSE_SUPPORT_CONTACT ? ` Fale com o suporte: ${this.env.LICENSE_SUPPORT_CONTACT}.` : ''}`;
        this.state = { ok: false, status: 'SUSPENDED', planName: this.state.planName, limits: this.state.limits, message };
        await this.persist({ status: 'SUSPENDED', ok: false, message, lastCheckedAt: now });
        this.log.error(`Licença sem confirmação há ${Math.round(staleMs / 86_400_000)} dias: bloqueando.`);
      } else {
        await this.persist({ lastCheckedAt: now });
        this.log.warn(`Não foi possível confirmar a licença (${(e as Error).message}). Ainda dentro do prazo de tolerância.`);
      }
    }
  }
}
