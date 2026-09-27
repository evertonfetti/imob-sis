import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { StaffAuthResponse } from '@imob/types';
import { ENV, Env } from '../config/env';
import { AppException } from '../common/app-exception';
import type { ReqCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { Inject } from '@nestjs/common';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(48).toString('base64url');
// Hash real e descartável: iguala o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash('dummy-password-for-timing'));

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async issueTokens(staffId: string, ctx: ReqCtx): Promise<StaffAuthResponse> {
    const staff = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } });
    const accessToken = await this.jwt.signAsync({ sub: staff.id });
    const refreshToken = newToken();
    await this.prisma.refreshToken.create({
      data: {
        staffId,
        tokenHash: sha256(refreshToken),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS, staff: { id: staff.id, name: staff.name, email: staff.email } };
  }

  async login(email: string, password: string, ctx: ReqCtx): Promise<StaffAuthResponse> {
    const staff = await this.prisma.staffUser.findUnique({ where: { email } });
    const ok = await verify(staff?.passwordHash ?? (await getDummyHash()), password).catch(() => false);
    if (!staff || !ok) throw new AppException('AUTH_INVALID_CREDENTIALS', 401);
    if (staff.status !== 'ACTIVE') throw new AppException('AUTH_USER_INACTIVE', 403);
    await this.prisma.staffUser.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(staff.id, ctx);
  }

  /** Rotação: cada refresh token só vale uma vez. Reuso de token revogado derruba todas as sessões. */
  async refresh(token: string, ctx: ReqCtx): Promise<StaffAuthResponse> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { staff: true } });
    if (!row) throw new AppException('AUTH_REFRESH_INVALID', 401);
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { staffId: row.staffId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new AppException('AUTH_REFRESH_INVALID', 401);
    }
    if (row.expiresAt < new Date()) throw new AppException('AUTH_REFRESH_INVALID', 401);
    if (row.staff.status !== 'ACTIVE') throw new AppException('AUTH_USER_INACTIVE', 403);

    const revoked = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (revoked.count === 0) throw new AppException('AUTH_REFRESH_INVALID', 401);
    return this.issueTokens(row.staffId, ctx);
  }

  async logout(token: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.revokedAt) return;
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  }
}
