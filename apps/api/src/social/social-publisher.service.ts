import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SocialAccountsService } from './social-accounts.service';
import { SocialMediaService } from './social-media.service';
import { SocialApiError } from './social.client';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 300_000]; // 1 min, depois 5 min
const STALE_LOCK_MS = 10 * 60_000;

/**
 * Agendador e publicador. O banco é a fonte da verdade: nada fica só em memória, então um reinício não perde
 * publicações agendadas. A trava (FOR UPDATE SKIP LOCKED) permite várias instâncias sem publicar em duplicidade.
 */
@Injectable()
export class SocialPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SocialPublisher');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly accounts: SocialAccountsService,
    private readonly media: SocialMediaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return; // nos testes o `tick()` é chamado explicitamente
    this.timer = setInterval(() => void this.tick(), this.env.SOCIAL_TICK_MS);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Chamado ao criar "publicar agora": não espera o próximo ciclo. */
  kick() {
    if (this.env.NODE_ENV === 'test') return;
    void this.tick();
  }

  /** Reserva as publicações vencidas (ou com nova tentativa devida) e publica. Retorna quantas processou. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = new Date();
      const stale = new Date(now.getTime() - STALE_LOCK_MS);
      const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE social_posts SET status = 'PUBLISHING', "lockedAt" = ${now}
        WHERE id IN (
          SELECT p.id FROM social_posts p
          WHERE (p.status = 'SCHEDULED' AND p."scheduledAt" <= ${now})
             OR (p.status = 'PUBLISHING' AND (p."lockedAt" IS NULL OR p."lockedAt" < ${stale})
                 AND EXISTS (SELECT 1 FROM social_post_targets t WHERE t."postId" = p.id AND t.status = 'PENDING' AND (t."nextAttemptAt" IS NULL OR t."nextAttemptAt" <= ${now})))
          ORDER BY p."scheduledAt" LIMIT 5 FOR UPDATE SKIP LOCKED)
        RETURNING id`;
      for (const { id } of claimed) {
        try { await this.processPost(id); } catch (e) { this.log.error(`Falha ao processar publicação ${id}: ${(e as Error).message}`); await this.unlock(id); }
      }
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private unlock(id: string) { return this.prisma.socialPost.updateMany({ where: { id, status: 'PUBLISHING' }, data: { lockedAt: null } }); }

  private async processPost(id: string) {
    const post = await this.prisma.socialPost.findUniqueOrThrow({ where: { id }, include: { targets: { include: { account: true } }, property: { select: { code: true } } } });
    const now = new Date();
    const due = post.targets.filter((t) => t.status === 'PENDING' && (!t.nextAttemptAt || t.nextAttemptAt <= now));

    if (due.length) {
      let urls: string[];
      try { urls = await this.media.jpegUrls(post.companyId, post.mediaIds); }
      catch (e) {
        for (const t of due) await this.prisma.socialPostTarget.update({ where: { id: t.id }, data: { status: 'FAILED', retryable: false, attempts: { increment: 1 }, error: `Não foi possível preparar as fotos: ${(e as Error).message}`.slice(0, 300) } });
        return this.finalize(id);
      }
      for (const t of due) await this.publishTarget(post, t, urls);
    }
    await this.finalize(id);
  }

  private async publishTarget(post: { id: string; companyId: string; propertyId: string; caption: string }, t: { id: string; attempts: number; account: { id: string; provider: string; externalId: string; pageId: string | null; secrets: string; name: string } }, urls: string[]) {
    const attempts = t.attempts + 1;
    const g = this.accounts.graph();
    try {
      const token = this.accounts.token(t.account.secrets);
      let externalId: string; let permalink: string | null;
      if (t.account.provider === 'INSTAGRAM') {
        const r = await g.publishToInstagram(t.account.externalId, token, { caption: post.caption, imageUrls: urls });
        externalId = r.id; permalink = await g.instagramPermalink(r.id, token);
      } else {
        const r = await g.publishToPage(t.account.externalId, token, { message: post.caption, imageUrls: urls });
        externalId = r.id; permalink = await g.facebookPermalink(r.id, token);
      }
      await this.prisma.socialPostTarget.update({ where: { id: t.id }, data: { status: 'PUBLISHED', externalId, permalink, attempts, error: null, retryable: false, nextAttemptAt: null, publishedAt: new Date() } });
      await this.audit.record({ companyId: post.companyId, entity: 'PROPERTY', entityId: post.propertyId, action: 'SOCIAL_PUBLISHED', after: { network: t.account.provider === 'INSTAGRAM' ? 'Instagram' : 'Facebook', account: t.account.name, permalink } });
    } catch (e) {
      const err = e instanceof SocialApiError ? e : new SocialApiError((e as Error).message);
      const msg = (err.auth ? 'A conexão com esta conta expirou. Reconecte a conta em Redes sociais. ' : '') + err.message;
      if (err.auth) await this.accounts.markExpired(t.account.id);
      const retry = err.retryable && attempts < MAX_ATTEMPTS;
      await this.prisma.socialPostTarget.update({
        where: { id: t.id },
        data: retry
          ? { attempts, error: msg.slice(0, 300), retryable: true, nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? 300_000)) }
          : { status: 'FAILED', attempts, error: msg.slice(0, 300), retryable: false, nextAttemptAt: null },
      });
    }
  }

  /** Define o status da publicação a partir do resultado de cada rede. */
  private async finalize(id: string) {
    const targets = await this.prisma.socialPostTarget.findMany({ where: { postId: id } });
    if (targets.some((t) => t.status === 'PENDING')) { await this.unlock(id); return; } // há nova tentativa marcada
    const ok = targets.filter((t) => t.status === 'PUBLISHED').length;
    const status = ok === targets.length ? 'PUBLISHED' : ok > 0 ? 'PARTIAL' : 'FAILED';
    await this.prisma.socialPost.update({ where: { id }, data: { status, lockedAt: null, publishedAt: ok > 0 ? new Date() : null } });
  }
}
