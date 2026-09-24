import { Injectable } from '@nestjs/common';
import type { Company } from '@imob/database';
import type { BranchInput, UpdateCompanyInput } from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { notFound } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const blankToNull = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  get(companyId: string): Promise<Company> {
    return this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  }

  async update(ctx: AuthedCtx, input: UpdateCompanyInput) {
    const { companyId } = ctx.user;
    const current = await this.get(companyId);
    const updated = await this.prisma.company.update({ where: { id: companyId }, data: blankToNull(input) });
    const d = diff(sanitize(current), sanitize(updated));
    if (d.changed) {
      await this.audit.record({ companyId, entity: 'COMPANY', entityId: companyId, action: 'UPDATE', before: d.before, after: d.after, ctx });
    }
    return updated;
  }

  listBranches(companyId: string) {
    return this.prisma.branch.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  async createBranch(ctx: AuthedCtx, input: BranchInput) {
    const { companyId } = ctx.user;
    const branch = await this.prisma.branch.create({ data: { ...blankToNull(input), companyId } as never });
    await this.audit.record({ companyId, entity: 'BRANCH', entityId: branch.id, action: 'CREATE', after: sanitize(branch), ctx });
    return branch;
  }

  async updateBranch(ctx: AuthedCtx, id: string, input: Partial<BranchInput>) {
    const { companyId } = ctx.user;
    const current = await this.prisma.branch.findFirst({ where: { id, companyId } });
    if (!current) throw notFound('Filial não encontrada.');
    const updated = await this.prisma.branch.update({ where: { id }, data: blankToNull(input) });
    const d = diff(sanitize(current), sanitize(updated));
    if (d.changed) {
      await this.audit.record({ companyId, entity: 'BRANCH', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    }
    return updated;
  }
}
