import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthResponse, AuthUser } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthedUser, ReqCtx } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(48).toString('base64url');
// Hash real e descartável: iguala o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash('dummy-password-for-timing'));

export function toAuthUser(u: AuthedUser): AuthUser {
  return {
    id: u.id,
    companyId: u.companyId,
    branchId: u.branchId,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: { key: u.roleKey, name: u.roleName },
    permissions: u.permissions,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async loadAuthed(userId: string): Promise<AuthedUser> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    return {
      id: u.id,
      companyId: u.companyId,
      branchId: u.branchId,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      roleKey: u.role.key,
      roleName: u.role.name,
      permissions: u.role.permissions.map((rp) => rp.permission.key),
    };
  }

  private async issueTokens(userId: string, ctx: ReqCtx): Promise<AuthResponse> {
    const user = await this.loadAuthed(userId);
    const accessToken = await this.jwt.signAsync({ sub: user.id, cid: user.companyId });
    const refreshToken = newToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS, user: toAuthUser(user) };
  }

  async login(email: string, password: string, ctx: ReqCtx): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verify(user?.passwordHash ?? (await getDummyHash()), password).catch(() => false);

    if (!user || !ok) {
      if (user) {
        await this.audit.record({
          companyId: user.companyId,
          userId: user.id,
          entity: 'AUTH',
          entityId: user.id,
          action: 'LOGIN_FAILED',
          ctx,
        });
      }
      throw new AppException('AUTH_INVALID_CREDENTIALS', 401);
    }
    if (user.status !== 'ACTIVE') throw new AppException('AUTH_USER_INACTIVE', 403);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      entity: 'AUTH',
      entityId: user.id,
      action: 'LOGIN',
      ctx,
    });
    return this.issueTokens(user.id, ctx);
  }

  /** Rotação: cada refresh token só vale uma vez. Reuso de token revogado derruba todas as sessões. */
  async refresh(token: string, ctx: ReqCtx): Promise<AuthResponse> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row) throw new AppException('AUTH_REFRESH_INVALID', 401);

    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppException('AUTH_REFRESH_INVALID', 401);
    }
    if (row.expiresAt < new Date()) throw new AppException('AUTH_REFRESH_INVALID', 401);
    if (row.user.status !== 'ACTIVE') throw new AppException('AUTH_USER_INACTIVE', 403);

    // Revogação condicional evita que duas requisições simultâneas usem o mesmo token.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new AppException('AUTH_REFRESH_INVALID', 401);

    return this.issueTokens(row.userId, ctx);
  }

  async logout(token: string, ctx: ReqCtx) {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.revokedAt) return;
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await this.audit.record({
      companyId: row.user.companyId,
      userId: row.userId,
      entity: 'AUTH',
      entityId: row.userId,
      action: 'LOGOUT',
      ctx,
    });
  }

  async forgotPassword(email: string, ctx: ReqCtx) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return; // resposta idêntica: não revela se o e-mail existe
    const token = newToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const link = `${this.env.ADMIN_URL}/redefinir-senha?token=${token}`;
    await this.mail.send(user.email, 'Redefinição de senha', `Use o link (válido por 1 hora): ${link}`);
    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      entity: 'AUTH',
      entityId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      ctx,
    });
  }

  async resetPassword(token: string, password: string, ctx: ReqCtx) {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppException('AUTH_RESET_INVALID', 400);

    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw new AppException('AUTH_RESET_INVALID', 400);

    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hash(password) } });
    await this.prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      companyId: row.user.companyId,
      userId: row.userId,
      entity: 'AUTH',
      entityId: row.userId,
      action: 'PASSWORD_RESET',
      ctx,
    });
  }
}
