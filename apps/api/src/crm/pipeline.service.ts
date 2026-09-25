import { Injectable } from '@nestjs/common';
import { ensureDefaultPipeline } from '@imob/database';
import type { BoardCard, BoardColumn, StageDto, StageType } from '@imob/types';
import { AuditService, diff, sanitize } from '../audit/audit.service';
import { notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { leadScope } from './visibility';

const BOARD_PAGE = 50;

export interface BoardFilters { search?: string; brokerId?: string; source?: string; propertyId?: string }

@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Funil ativo da empresa (criado com os estágios padrão se ainda não existir). */
  async get(companyId: string) {
    const p = await ensureDefaultPipeline(this.prisma, companyId);
    return { id: p.id, name: p.name, stages: p.stages.map((s) => this.dto(s)) };
  }

  dto(s: { id: string; name: string; position: number; color: string; type: string; qualifies: boolean }): StageDto {
    return { id: s.id, name: s.name, position: s.position, color: s.color, type: s.type as StageType, qualifies: s.qualifies };
  }

  async board(user: AuthedUser, f: BoardFilters): Promise<{ pipeline: { id: string; name: string }; columns: BoardColumn[] }> {
    const pipeline = await this.get(user.companyId);
    const firstId = pipeline.stages[0]?.id;

    const filters: Record<string, unknown>[] = [];
    if (f.search) {
      const c = { contains: f.search, mode: 'insensitive' as const };
      filters.push({ OR: [{ customer: { name: c } }, { customer: { phone: { contains: f.search.replace(/\D/g, '') || f.search } } }, { property: { code: c } }] });
    }
    const base = {
      ...leadScope(user),
      ...(f.brokerId && (f.brokerId === 'none' ? { brokerId: null } : { brokerId: f.brokerId })),
      ...(f.source && { source: f.source as never }),
      ...(f.propertyId && { propertyId: f.propertyId }),
      ...(filters.length && { AND: filters }),
    };

    const columns = await Promise.all(
      pipeline.stages.map(async (stage): Promise<BoardColumn> => {
        // Leads antigos sem estágio caem na primeira coluna (o bootstrap também os corrige).
        const where = { ...base, ...(stage.id === firstId ? { AND: [...((base as { AND?: unknown[] }).AND ?? []), { OR: [{ stageId: stage.id }, { stageId: null }] }] } : { stageId: stage.id }) };
        const [total, rows] = await Promise.all([
          this.prisma.lead.count({ where: where as never }),
          this.prisma.lead.findMany({
            where: where as never, orderBy: { stageEnteredAt: 'desc' }, take: BOARD_PAGE,
            include: {
              customer: { select: { id: true, name: true, phone: true } },
              property: { select: { id: true, code: true, title: true } },
              broker: { select: { id: true, name: true } },
            },
          }),
        ]);
        return { stage, total, leads: rows.map((r) => this.card(r)) };
      }),
    );

    // Tarefas atrasadas por lead (indicador no cartão).
    const ids = columns.flatMap((c) => c.leads.map((l) => l.id));
    if (ids.length) {
      const overdue = await this.prisma.task.groupBy({
        by: ['leadId'], where: { leadId: { in: ids }, status: 'OPEN', dueAt: { lt: new Date() } }, _count: true,
      });
      const map = new Map(overdue.map((o) => [o.leadId, o._count]));
      for (const c of columns) for (const l of c.leads) l.overdueTasks = map.get(l.id) ?? 0;
    }
    return { pipeline: { id: pipeline.id, name: pipeline.name }, columns };
  }

  private card(r: { id: string; source: string; stageEnteredAt: Date; createdAt: Date; customer: { id: string; name: string; phone: string | null }; property: { id: string; code: string; title: string } | null; broker: { id: string; name: string } | null }): BoardCard {
    return {
      id: r.id, customer: r.customer, property: r.property, broker: r.broker, source: r.source,
      stageEnteredAt: r.stageEnteredAt.toISOString(), createdAt: r.createdAt.toISOString(), overdueTasks: 0,
    };
  }

  async updateStage(ctx: AuthedCtx, id: string, input: { name?: string; color?: string }) {
    const { companyId } = ctx.user;
    const current = await this.prisma.pipelineStage.findFirst({ where: { id, pipeline: { companyId } } });
    if (!current) throw notFound('Estágio não encontrado.');
    const updated = await this.prisma.pipelineStage.update({ where: { id }, data: input });
    const d = diff(sanitize(current), sanitize(updated));
    if (d.changed) {
      await this.audit.record({ companyId, entity: 'PIPELINE_STAGE', entityId: id, action: 'UPDATE', before: d.before, after: d.after, ctx });
    }
    return this.dto(updated);
  }
}
