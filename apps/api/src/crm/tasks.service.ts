import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CreateTaskInput } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { blankToNull } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';
import { CrmEvents, type TaskEvent } from './crm.events';
import { canViewAll, leadScope, taskScope } from './visibility';

const include = {
  lead: { select: { id: true, customer: { select: { id: true, name: true, phone: true } } } },
  property: { select: { id: true, code: true, title: true } },
  assignedUser: { select: { id: true, name: true } },
} as const;

interface ListQuery { page: number; pageSize: number; view: 'open' | 'overdue' | 'today' | 'done'; assignedUserId?: string; leadId?: string; from?: string; to?: string }

@Injectable()
export class TasksService {
  private readonly log = new Logger('Tasks');
  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  private async emit(name: string, payload: TaskEvent) {
    try { await this.events.emitAsync(name, payload); } catch (e) { this.log.error(`Falha ao processar ${name}: ${(e as Error).message}`); }
  }

  async list(user: AuthedUser, q: ListQuery) {
    const now = new Date();
    const dayStart = q.from ? new Date(q.from) : new Date(new Date().setUTCHours(0, 0, 0, 0));
    const dayEnd = q.to ? new Date(q.to) : new Date(dayStart.getTime() + 86_400_000);
    const byView =
      q.view === 'done' ? { status: 'DONE' as const }
      : q.view === 'overdue' ? { status: 'OPEN' as const, dueAt: { lt: now } }
      : q.view === 'today' ? { status: 'OPEN' as const, dueAt: { gte: dayStart, lt: dayEnd } }
      : { status: 'OPEN' as const };
    const where = {
      ...taskScope(user), ...byView,
      ...(q.leadId && { leadId: q.leadId }),
      ...(q.assignedUserId && { assignedUserId: q.assignedUserId === 'me' ? user.id : q.assignedUserId }),
    };
    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where, include,
        orderBy: q.view === 'done' ? { completedAt: 'desc' } : [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async create(ctx: AuthedCtx, input: CreateTaskInput) {
    const { companyId } = ctx.user;
    let lead: { id: string; brokerId: string | null } | null = null;
    if (input.leadId) {
      lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, ...leadScope(ctx.user) }, select: { id: true, brokerId: true } });
      if (!lead) throw notFound('Lead não encontrado.');
    }
    if (input.propertyId && !(await this.prisma.property.findFirst({ where: { id: input.propertyId, companyId }, select: { id: true } }))) {
      throw new AppException('PROPERTY_INVALID', 400);
    }
    const assignee = input.assignedUserId ?? lead?.brokerId ?? ctx.user.id;
    if (!(await this.prisma.user.findFirst({ where: { id: assignee, companyId, status: 'ACTIVE' }, select: { id: true } }))) {
      throw new AppException('LEAD_BROKER_INVALID', 400);
    }
    const { assignedUserId: _a, ...rest } = input;
    const task = await this.prisma.task.create({
      data: { ...(blankToNull(rest) as object), companyId, assignedUserId: assignee, createdById: ctx.user.id, dueAt: input.dueAt ? new Date(input.dueAt) : null } as never,
      include,
    });
    if (task.leadId) await this.emit(CrmEvents.TaskCreated, { companyId, leadId: task.leadId, userId: ctx.user.id, taskId: task.id, title: task.title });
    return task;
  }

  /** Criação feita pelo sistema (automação), sem usuário logado. */
  async createSystem(input: { companyId: string; leadId: string; assignedUserId: string | null; title: string; type: CreateTaskInput['type']; priority: CreateTaskInput['priority']; dueAt: Date; ref?: string }) {
    const task = await this.prisma.task.create({ data: { ...input, createdById: null } });
    await this.emit(CrmEvents.TaskCreated, { companyId: input.companyId, leadId: input.leadId, userId: null, taskId: task.id, title: task.title });
    return task;
  }

  /** Cancela tarefas automáticas em aberto ligadas a um evento (ex.: visita reagendada/cancelada). */
  cancelByRef(companyId: string, ref: string) {
    return this.prisma.task.updateMany({ where: { companyId, ref, status: 'OPEN' }, data: { status: 'CANCELLED' } });
  }

  private async load(user: AuthedUser, id: string) {
    const t = await this.prisma.task.findFirst({ where: { id, ...taskScope(user) }, include });
    if (!t) throw notFound('Tarefa não encontrada.');
    return t;
  }

  async update(ctx: AuthedCtx, id: string, input: Partial<CreateTaskInput>) {
    const current = await this.load(ctx.user, id);
    if (current.status !== 'OPEN') throw new AppException('TASK_INVALID', 409);
    const { assignedUserId, propertyId, ...rest } = input;
    if (assignedUserId && !(await this.prisma.user.findFirst({ where: { id: assignedUserId, companyId: ctx.user.companyId, status: 'ACTIVE' }, select: { id: true } }))) {
      throw new AppException('LEAD_BROKER_INVALID', 400);
    }
    if (propertyId && !(await this.prisma.property.findFirst({ where: { id: propertyId, companyId: ctx.user.companyId }, select: { id: true } }))) {
      throw new AppException('PROPERTY_INVALID', 400);
    }
    return this.prisma.task.update({
      where: { id },
      data: { ...(blankToNull(rest) as object), ...(assignedUserId && { assignedUserId }), ...(propertyId !== undefined && { propertyId }), ...(input.dueAt !== undefined && { dueAt: input.dueAt ? new Date(input.dueAt) : null }) } as never,
      include,
    });
  }

  async complete(ctx: AuthedCtx, id: string) {
    const t = await this.load(ctx.user, id);
    if (t.status !== 'OPEN') throw new AppException('TASK_INVALID', 409);
    const done = await this.prisma.task.update({ where: { id }, data: { status: 'DONE', completedAt: new Date() }, include });
    if (t.leadId) await this.emit(CrmEvents.TaskCompleted, { companyId: ctx.user.companyId, leadId: t.leadId, userId: ctx.user.id, taskId: id, title: t.title });
    return done;
  }

  async cancel(ctx: AuthedCtx, id: string) {
    const t = await this.load(ctx.user, id);
    if (t.status !== 'OPEN') throw new AppException('TASK_INVALID', 409);
    await this.prisma.task.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  canSeeAll(user: AuthedUser) { return canViewAll(user); }
}
