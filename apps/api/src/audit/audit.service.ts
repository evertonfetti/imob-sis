import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ReqCtx } from '../common/request-context';

export interface AuditInput {
  companyId: string;
  entity: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ctx?: ReqCtx;
  userId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(i: AuditInput) {
    await this.prisma.auditLog.create({
      data: {
        companyId: i.companyId,
        userId: i.userId ?? i.ctx?.user?.id ?? null,
        entity: i.entity,
        entityId: i.entityId ?? null,
        action: i.action,
        before: (i.before ?? undefined) as never,
        after: (i.after ?? undefined) as never,
        ipAddress: i.ctx?.ip,
        userAgent: i.ctx?.userAgent,
      },
    });
  }
}

/** Remove campos sensíveis e converte datas antes de gravar em before/after. */
export function sanitize<T extends object>(obj: T): Record<string, unknown> {
  const { passwordHash: _p, ...rest } = obj as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest));
}

/** Retorna apenas os campos que mudaram. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
