import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SocialAccountDto, SocialAppDto, SocialAppInput, UpdateSocialAppInput } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import { decryptJson, encryptJson, secretKeyFor } from '../common/crypto';
import type { AuthedCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SocialApiError, SocialGraph } from './social.client';

/** Permissões pedidas no login: listar Páginas, publicar nelas e no Instagram profissional ligado. */
export const SOCIAL_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'];
const STATE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 60 * 60_000;

interface Secrets { accessToken: string }

@Injectable()
export class SocialAccountsService {
  private readonly log = new Logger('SocialAccounts');
  private readonly key: Buffer;

  constructor(@Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService, private readonly audit: AuditService) {
    this.key = secretKeyFor(env);
  }

  get redirectUri() { return `${(this.env.API_PUBLIC_URL ?? '').replace(/\/$/, '')}/api/v1/social/oauth/callback`; }

  // ---------- Aplicativos da Meta (vários por empresa; as variáveis de ambiente são só um app padrão opcional) ----------
  private get serverApp() { return this.env.META_APP_ID && this.env.META_APP_SECRET ? { appId: this.env.META_APP_ID, appSecret: this.env.META_APP_SECRET } : null; }

  // Privado por padrão: só o dono usa; `shared` libera para a equipe. Administradores gerenciam o que foi compartilhado.
  private visibleApp = (u: { companyId: string; id: string }) => ({ companyId: u.companyId, OR: [{ createdById: u.id }, { shared: true }] });
  private visibleAccount = (u: { companyId: string; id: string }) => ({ companyId: u.companyId, OR: [{ connectedById: u.id }, { shared: true }] });
  private canManage(u: { id: string; permissions: string[] }, ownerId: string | null, shared: boolean) {
    return ownerId === u.id || (shared && u.permissions.includes('admin.company'));
  }

  /** Credenciais do app escolhido (id do cadastro ou 'server'). `null` = não existe, não é da empresa ou (com `userId`) não está disponível para o usuário. */
  async credentials(companyId: string, ref: string, userId?: string): Promise<{ appId: string; appSecret: string; name: string; ref: string } | null> {
    if (ref === 'server') return this.serverApp ? { ...this.serverApp, name: 'Padrão do sistema', ref } : null;
    const r = await this.prisma.socialApp.findFirst({ where: userId ? { id: ref, ...this.visibleApp({ companyId, id: userId }) } : { id: ref, companyId } });
    return r ? { appId: r.appId, appSecret: decryptJson<{ appSecret: string }>(r.secrets, this.key).appSecret, name: r.name, ref: r.id } : null;
  }

  private graphFor(cred: { appId: string; appSecret: string } | null) {
    return new SocialGraph({
      graphUrl: this.env.WHATSAPP_GRAPH_URL, oauthUrl: this.env.META_OAUTH_URL, version: this.env.WHATSAPP_API_VERSION,
      appId: cred?.appId ?? '', appSecret: cred?.appSecret ?? '', pollMs: this.env.SOCIAL_POLL_MS,
    });
  }

  /** Cliente sem credenciais de app: basta para publicar e consultar com o token da própria Página. */
  async graph(_companyId: string) { return this.graphFor(null); }

  private async validate(appId: string, appSecret: string) {
    try {
      await this.graphFor({ appId, appSecret }).validateApp();
    } catch (e) {
      if (e instanceof SocialApiError && e.status !== undefined && e.status < 500) throw new AppException('SOCIAL_APP_INVALID', 400);
      throw new AppException('SOCIAL_APP_INVALID', 502, `Não foi possível validar com a Meta agora: ${(e as Error).message}`);
    }
  }

  async createApp(ctx: AuthedCtx, input: SocialAppInput) {
    const { companyId } = ctx.user;
    if (!input.appSecret) throw new AppException('VALIDATION_FAILED', 400, 'Informe a chave secreta do aplicativo.');
    if (await this.prisma.socialApp.findFirst({ where: { companyId, createdById: ctx.user.id, appId: input.appId } })) throw new AppException('SOCIAL_APP_DUPLICATE', 409);
    await this.validate(input.appId, input.appSecret);
    const saved = await this.prisma.socialApp.create({ data: { companyId, name: input.name, appId: input.appId, secrets: encryptJson({ appSecret: input.appSecret }, this.key), createdById: ctx.user.id, shared: !!input.shared } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: saved.id, action: 'CREATE', after: { provider: 'META_APP', name: input.name, appId: input.appId, shared: !!input.shared }, ctx });
    return this.list(ctx.user);
  }

  async updateApp(ctx: AuthedCtx, id: string, input: UpdateSocialAppInput) {
    const { companyId } = ctx.user;
    const cur = await this.prisma.socialApp.findFirst({ where: { id, ...this.visibleApp(ctx.user) } });
    if (!cur) throw notFound('Aplicativo não encontrado.');
    if (!this.canManage(ctx.user, cur.createdById, cur.shared)) throw new AppException('SOCIAL_FORBIDDEN', 403);
    const appId = input.appId ?? cur.appId;
    const appSecret = input.appSecret ?? decryptJson<{ appSecret: string }>(cur.secrets, this.key).appSecret;
    if (input.appId && input.appId !== cur.appId && (await this.prisma.socialApp.findFirst({ where: { companyId, createdById: cur.createdById, appId } }))) throw new AppException('SOCIAL_APP_DUPLICATE', 409);
    if (input.appId || input.appSecret) await this.validate(appId, appSecret);
    await this.prisma.socialApp.update({ where: { id }, data: { name: input.name ?? cur.name, appId, ...(input.shared !== undefined && { shared: input.shared }), ...(input.appSecret && { secrets: encryptJson({ appSecret }, this.key) }) } });
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: id, action: 'UPDATE', after: { provider: 'META_APP', name: input.name ?? cur.name, appId, secretChanged: !!input.appSecret, ...(input.shared !== undefined && { shared: input.shared }) }, ctx });
    return this.list(ctx.user);
  }

  async removeApp(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const cur = await this.prisma.socialApp.findFirst({ where: { id, ...this.visibleApp(ctx.user) } });
    if (!cur) throw notFound('Aplicativo não encontrado.');
    if (!this.canManage(ctx.user, cur.createdById, cur.shared)) throw new AppException('SOCIAL_FORBIDDEN', 403);
    await this.prisma.socialApp.delete({ where: { id } }); // contas conectadas por ele continuam publicando (o token é da Página)
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: id, action: 'DELETE', before: { provider: 'META_APP', name: cur.name, appId: cur.appId }, ctx });
  }

  /** Token da conta (descriptografado). Só para uso interno do publicador. */
  token(secrets: string) { return decryptJson<Secrets>(secrets, this.key).accessToken; }

  // ---------- state assinado (proteção CSRF do login) ----------
  // HMAC próprio, NÃO um JWT de acesso: assim ele nunca pode ser aceito como token de login.
  private sign(payload: object) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', this.key).update(`social-oauth.${body}`).digest('base64url')}`;
  }

  private verify(state: string): { cid: string; uid: string; app: string } | null {
    const [body, sig] = (state ?? '').split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(createHmac('sha256', this.key).update(`social-oauth.${body}`).digest('base64url'));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return p.exp > Date.now() && p.cid && p.uid && p.app ? { cid: p.cid, uid: p.uid, app: p.app } : null;
    } catch { return null; }
  }

  async connectUrl(ctx: AuthedCtx, appRef?: string) {
    const { companyId, id: userId } = ctx.user;
    let ref = appRef;
    if (!ref) {
      const mine = await this.prisma.socialApp.findMany({ where: this.visibleApp(ctx.user), select: { id: true }, take: 2 });
      const options = mine.length + (this.serverApp ? 1 : 0);
      if (options === 0) throw new AppException('SOCIAL_NOT_CONFIGURED', 409);
      if (options > 1) throw new AppException('SOCIAL_APP_REQUIRED', 400);
      ref = mine[0]?.id ?? 'server';
    }
    const cred = await this.credentials(companyId, ref, userId);
    if (!cred) throw new AppException(appRef ? 'SOCIAL_APP_REQUIRED' : 'SOCIAL_NOT_CONFIGURED', appRef ? 400 : 409);
    const state = this.sign({ cid: companyId, uid: userId, app: cred.ref, exp: Date.now() + STATE_TTL_MS, n: randomBytes(8).toString('hex') });
    return { url: this.graphFor(cred).oauthDialogUrl({ redirectUri: this.redirectUri, state, scopes: SOCIAL_SCOPES }) };
  }

  /** Retorno do Facebook. Sempre devolve o status para a tela do painel (nunca expõe erro técnico ao navegador). */
  async handleCallback(q: { code?: string; state?: string; error?: string }): Promise<'connected' | 'denied' | 'empty' | 'error'> {
    const st = q.state ? this.verify(q.state) : null;
    if (!st) return 'error';
    if (q.error || !q.code) return 'denied';
    try {
      const cred = await this.credentials(st.cid, st.app);
      if (!cred) return 'error';
      const g = this.graphFor(cred);
      const long = await g.longLived(await g.exchangeCode(q.code, this.redirectUri));
      const pages = await g.listPages(long);
      if (!pages.length) return 'empty';

      // Contas pendentes esquecidas (o usuário não escolheu) não ficam guardadas para sempre.
      await this.prisma.socialAccount.deleteMany({ where: { companyId: st.cid, status: 'PENDING', updatedAt: { lt: new Date(Date.now() - PENDING_TTL_MS) } } });

      for (const p of pages) {
        const secrets = encryptJson({ accessToken: p.access_token }, this.key);
        await this.upsert(st.cid, st.uid, cred.ref === 'server' ? null : cred.ref, { provider: 'FACEBOOK_PAGE', externalId: p.id, name: p.name, username: null, pictureUrl: p.picture?.data?.url ?? null, pageId: null, secrets });
        if (p.instagram_business_account) {
          const ig = p.instagram_business_account;
          await this.upsert(st.cid, st.uid, cred.ref === 'server' ? null : cred.ref, { provider: 'INSTAGRAM', externalId: ig.id, name: ig.username ?? `Instagram de ${p.name}`, username: ig.username ?? null, pictureUrl: ig.profile_picture_url ?? null, pageId: p.id, secrets });
        }
      }
      await this.audit.record({ companyId: st.cid, userId: st.uid, entity: 'SOCIAL_ACCOUNT', action: 'CONNECT', after: { pages: pages.length } });
      return 'connected';
    } catch (e) {
      this.log.warn(`Falha no login com o Facebook: ${(e as Error).message}`);
      return 'error';
    }
  }

  private async upsert(companyId: string, userId: string, socialAppId: string | null, a: { provider: 'FACEBOOK_PAGE' | 'INSTAGRAM'; externalId: string; name: string; username: string | null; pictureUrl: string | null; pageId: string | null; secrets: string }) {
    // Cada usuário tem a sua conexão do mesmo perfil (o token é dele).
    const existing = await this.prisma.socialAccount.findFirst({ where: { companyId, connectedById: userId, provider: a.provider, externalId: a.externalId } });
    if (existing) {
      // Token novo: uma conta que tinha expirado volta a funcionar; as que já estavam ativas continuam.
      await this.prisma.socialAccount.update({ where: { id: existing.id }, data: { name: a.name, username: a.username, pictureUrl: a.pictureUrl, pageId: a.pageId, secrets: a.secrets, connectedById: userId, socialAppId, status: existing.status === 'EXPIRED' ? 'ACTIVE' : existing.status } });
    } else {
      await this.prisma.socialAccount.create({ data: { ...a, companyId, connectedById: userId, socialAppId, status: 'PENDING' } });
    }
  }

  // ---------- Consulta e seleção ----------
  private dto(u: { id: string }, owners: Map<string, string>, a: { id: string; socialAppId?: string | null; app?: { name: string } | null; provider: string; externalId: string; name: string; username: string | null; pictureUrl: string | null; status: string; pageId: string | null; shared: boolean; connectedById: string | null }, pageNames: Map<string, string>): SocialAccountDto {
    return {
      id: a.id, appName: a.app?.name ?? null, appRef: a.socialAppId ?? null, mine: a.connectedById === u.id, shared: a.shared, ownerName: a.connectedById ? (owners.get(a.connectedById) ?? null) : null,
      provider: a.provider as SocialAccountDto['provider'], externalId: a.externalId, name: a.name, username: a.username, pictureUrl: a.pictureUrl,
      status: a.status as SocialAccountDto['status'], linkedPageName: a.pageId ? (pageNames.get(a.pageId) ?? null) : null,
    };
  }

  /** Só o que o usuário pode ver: as próprias contas/apps e o que colegas compartilharam. */
  async list(user: { id: string; companyId: string }) {
    const [rows, apps] = await Promise.all([
      this.prisma.socialAccount.findMany({ where: this.visibleAccount(user), include: { app: { select: { name: true } } }, orderBy: [{ provider: 'asc' }, { name: 'asc' }] }),
      this.prisma.socialApp.findMany({ where: this.visibleApp(user), orderBy: { createdAt: 'asc' } }),
    ]);
    const ownerIds = [...new Set([...rows.map((r) => r.connectedById), ...apps.map((a) => a.createdById)].filter((x): x is string => !!x))];
    const owners = new Map((ownerIds.length ? await this.prisma.user.findMany({ where: { id: { in: ownerIds }, companyId: user.companyId }, select: { id: true, name: true } }) : []).map((o) => [o.id, o.name]));
    const pageNames = new Map(rows.filter((r) => r.provider === 'FACEBOOK_PAGE').map((r) => [r.externalId, r.name]));
    const list: SocialAppDto[] = apps.map((a) => ({ id: a.id, name: a.name, appId: a.appId, source: 'company', accountCount: rows.filter((r) => r.socialAppId === a.id).length, mine: a.createdById === user.id, shared: a.shared, ownerName: a.createdById ? (owners.get(a.createdById) ?? null) : null }));
    if (this.serverApp) list.push({ id: 'server', name: 'Padrão do sistema', appId: this.serverApp.appId, source: 'server', accountCount: rows.filter((r) => !r.socialAppId).length, mine: false, shared: true, ownerName: null });
    return {
      configured: list.length > 0,
      apps: list,
      redirectUri: this.redirectUri,
      accounts: rows.filter((r) => r.status !== 'PENDING').map((r) => this.dto(user, owners, r, pageNames)),
      pending: rows.filter((r) => r.status === 'PENDING').map((r) => this.dto(user, owners, r, pageNames)),
    };
  }

  /** Marca como ativas as contas escolhidas e descarta as que ficaram pendentes (e seus tokens). */
  async activate(ctx: AuthedCtx, ids: string[]) {
    const { companyId } = ctx.user;
    const chosen = await this.prisma.socialAccount.findMany({ where: { id: { in: ids }, companyId, connectedById: ctx.user.id, status: 'PENDING' } }); // só as contas que você acabou de conectar
    if (chosen.length !== new Set(ids).size) throw new AppException('SOCIAL_ACCOUNT_INVALID', 400);
    await this.prisma.$transaction([
      this.prisma.socialAccount.updateMany({ where: { id: { in: ids }, companyId, connectedById: ctx.user.id }, data: { status: 'ACTIVE' } }),
      this.prisma.socialAccount.deleteMany({ where: { companyId, connectedById: ctx.user.id, status: 'PENDING', id: { notIn: ids } } }),
    ]);
    await this.audit.record({ companyId, entity: 'SOCIAL_ACCOUNT', action: 'ACTIVATE', after: { accounts: chosen.map((c) => `${c.provider}:${c.name}`) }, ctx });
    return this.list(ctx.user);
  }

  async remove(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const a = await this.prisma.socialAccount.findFirst({ where: { id, ...this.visibleAccount(ctx.user) } });
    if (!a) throw notFound('Conta não encontrada.');
    if (!this.canManage(ctx.user, a.connectedById, a.shared)) throw new AppException('SOCIAL_FORBIDDEN', 403);
    // Publicações agendadas deixam de mirar nesta conta; sem nenhum destino, são canceladas.
    const affected = await this.prisma.socialPostTarget.findMany({ where: { accountId: id, status: 'PENDING', post: { status: 'SCHEDULED' } }, select: { postId: true } });
    await this.prisma.socialPostTarget.deleteMany({ where: { accountId: id, status: 'PENDING', post: { status: 'SCHEDULED' } } });
    for (const { postId } of affected) {
      if ((await this.prisma.socialPostTarget.count({ where: { postId } })) === 0) await this.prisma.socialPost.update({ where: { id: postId }, data: { status: 'CANCELLED' } });
    }
    await this.prisma.socialAccount.delete({ where: { id } });
    await this.audit.record({ companyId, entity: 'SOCIAL_ACCOUNT', entityId: id, action: 'DISCONNECT', before: { provider: a.provider, name: a.name }, ctx });
  }

  /** Só quem conectou decide se a equipe pode publicar nesta conta. */
  async setShared(ctx: AuthedCtx, id: string, shared: boolean) {
    const a = await this.prisma.socialAccount.findFirst({ where: { id, ...this.visibleAccount(ctx.user) } });
    if (!a) throw notFound('Conta não encontrada.');
    if (a.connectedById !== ctx.user.id) throw new AppException('SOCIAL_FORBIDDEN', 403);
    if (a.status === 'PENDING') throw new AppException('SOCIAL_ACCOUNT_INVALID', 400);
    await this.prisma.socialAccount.update({ where: { id }, data: { shared } });
    await this.audit.record({ companyId: ctx.user.companyId, entity: 'SOCIAL_ACCOUNT', entityId: id, action: shared ? 'SHARE' : 'UNSHARE', after: { name: a.name, shared }, ctx });
    return this.list(ctx.user);
  }

  /** Confere se o token ainda vale; marca como expirada se a Meta recusar. */
  async check(ctx: AuthedCtx, id: string) {
    const a = await this.prisma.socialAccount.findFirst({ where: { id, ...this.visibleAccount(ctx.user) } });
    if (!a) throw notFound('Conta não encontrada.');
    try {
      await (await this.graph(ctx.user.companyId)).pageName(a.pageId ?? a.externalId, this.token(a.secrets));
      if (a.status === 'EXPIRED') await this.prisma.socialAccount.update({ where: { id }, data: { status: 'ACTIVE' } });
      return { ok: true, status: a.status === 'EXPIRED' ? 'ACTIVE' : a.status };
    } catch (e) {
      if (e instanceof SocialApiError && e.auth) { await this.markExpired(id); return { ok: false, status: 'EXPIRED' }; }
      throw new AppException('SOCIAL_ACCOUNT_INVALID', 502, `Não foi possível consultar a Meta: ${(e as Error).message}`);
    }
  }

  markExpired(id: string) { return this.prisma.socialAccount.updateMany({ where: { id }, data: { status: 'EXPIRED' } }); }
}
