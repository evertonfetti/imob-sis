import { Injectable } from '@nestjs/common';
import type { PlanDto, PlanInput, PlanLimits } from '@imob/types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  private dto(p: { id: string; key: string; name: string; priceCents: number; billingInterval: string; limits: unknown; active: boolean; _count?: { licenses: number } }): PlanDto {
    return {
      id: p.id, key: p.key, name: p.name, priceCents: p.priceCents, billingInterval: p.billingInterval as PlanDto['billingInterval'],
      limits: (p.limits ?? {}) as PlanLimits, active: p.active, licenseCount: p._count?.licenses ?? 0,
    };
  }

  async list() {
    const rows = await this.prisma.plan.findMany({ include: { _count: { select: { licenses: true } } }, orderBy: { priceCents: 'asc' } });
    return rows.map((r) => this.dto(r));
  }

  async create(input: PlanInput) {
    if (await this.prisma.plan.findUnique({ where: { key: input.key } })) throw new AppException('LICENSE_PLAN_KEY_TAKEN', 409);
    const created = await this.prisma.plan.create({ data: { ...input, limits: input.limits, active: input.active ?? true } });
    return this.dto(created);
  }

  async update(id: string, input: Partial<PlanInput>) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new AppException('LICENSE_PLAN_INVALID', 404);
    if (input.key && input.key !== plan.key && (await this.prisma.plan.findUnique({ where: { key: input.key } }))) {
      throw new AppException('LICENSE_PLAN_KEY_TAKEN', 409);
    }
    const updated = await this.prisma.plan.update({ where: { id }, data: input as never, include: { _count: { select: { licenses: true } } } });
    return this.dto(updated);
  }

  async remove(id: string) {
    const count = await this.prisma.license.count({ where: { planId: id, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } } });
    if (count > 0) throw new AppException('LICENSE_PLAN_IN_USE', 409);
    await this.prisma.plan.delete({ where: { id } }).catch(() => { throw new AppException('LICENSE_PLAN_INVALID', 404); });
  }
}
