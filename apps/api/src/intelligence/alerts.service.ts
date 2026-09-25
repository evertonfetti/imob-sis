import { Injectable } from '@nestjs/common';
import { type AlertDto } from '@imob/types';
import { IntelligenceSettingsService } from './settings.service';
import type { AuthedUser } from '../common/request-context';
import { canViewAll, leadScope, taskScope } from '../crm/visibility';
import { PrismaService } from '../prisma/prisma.service';
import { proposalScope } from '../commercial/proposals.service';
import { visitScope } from '../commercial/visits.service';

const H = 3_600_000;
const D = 24 * H;
const SEV = { high: 0, medium: 1, low: 2 } as const;
const ago = (d: Date) => { const h = Math.floor((Date.now() - d.getTime()) / H); return h < 1 ? 'há menos de 1 h' : h < 48 ? `há ${h} h` : `há ${Math.floor(h / 24)} dias`; };
const when = (d: Date) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Situações que pedem ação, calculadas na hora a partir dos dados (nada fica "esquecido" numa tabela de alertas). */
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: IntelligenceSettingsService) {}

  async list(user: AuthedUser): Promise<AlertDto[]> {
    const now = Date.now();
    const L = await this.settings.get(user.companyId); // limites da empresa (Configurações → Empresa)
    const lead = leadScope(user);
    const open = { status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] as ('NEW' | 'CONTACTED' | 'QUALIFIED')[] } };
    const first = await this.prisma.pipelineStage.findFirst({ where: { pipeline: { companyId: user.companyId } }, orderBy: { position: 'asc' }, select: { id: true } });

    const [unattended, stale, overdue, unconfirmed, noOutcome, expiring, idle, waiting] = await Promise.all([
      this.prisma.lead.findMany({ where: { ...lead, ...open, ...(first ? { stageId: first.id } : {}), stageEnteredAt: { lt: new Date(now - L.unattendedHours * H) } }, select: { id: true, stageEnteredAt: true, customer: { select: { name: true } } }, orderBy: { stageEnteredAt: 'asc' }, take: 15 }),
      this.prisma.lead.findMany({ where: { ...lead, ...open, ...(first ? { stageId: { not: first.id } } : {}), stageEnteredAt: { lt: new Date(now - L.staleDays * D) } }, select: { id: true, stageEnteredAt: true, customer: { select: { name: true } }, stage: { select: { name: true } } }, orderBy: { stageEnteredAt: 'asc' }, take: 15 }),
      this.prisma.task.count({ where: { ...taskScope(user), status: 'OPEN', dueAt: { lt: new Date(now) } } }),
      this.prisma.visit.findMany({ where: { ...visitScope(user), status: 'SCHEDULED', scheduledAt: { gt: new Date(now), lt: new Date(now + L.visitUnconfirmedHours * H) } }, select: { id: true, scheduledAt: true, lead: { select: { customer: { select: { name: true } } } } }, orderBy: { scheduledAt: 'asc' }, take: 15 }),
      this.prisma.visit.findMany({ where: { ...visitScope(user), status: { in: ['SCHEDULED', 'CONFIRMED'] }, scheduledAt: { lt: new Date(now - 2 * H) } }, select: { id: true, scheduledAt: true, lead: { select: { customer: { select: { name: true } } } } }, orderBy: { scheduledAt: 'asc' }, take: 15 }),
      this.prisma.proposal.findMany({ where: { ...proposalScope(user), status: { in: ['SENT', 'UNDER_REVIEW', 'COUNTERED'] }, validUntil: { gt: new Date(now), lt: new Date(now + L.proposalExpiringHours * H) } }, select: { id: true, validUntil: true, leadId: true, property: { select: { code: true } }, lead: { select: { customer: { select: { name: true } } } } }, orderBy: { validUntil: 'asc' }, take: 15 }),
      this.prisma.proposal.findMany({ where: { ...proposalScope(user), status: { in: ['SENT', 'UNDER_REVIEW', 'COUNTERED'] }, updatedAt: { lt: new Date(now - L.proposalIdleDays * D) } }, select: { id: true, updatedAt: true, leadId: true, property: { select: { code: true } }, lead: { select: { customer: { select: { name: true } } } } }, orderBy: { updatedAt: 'asc' }, take: 15 }),
      this.prisma.conversation.findMany({ where: { companyId: user.companyId, unreadCount: { gt: 0 }, lastInboundAt: { lt: new Date(now - L.whatsappWaitingHours * H) }, leadId: { not: null }, ...(canViewAll(user) ? {} : { lead: { brokerId: user.id } }) }, select: { id: true, lastInboundAt: true, contactName: true, lead: { select: { customer: { select: { name: true } } } } }, orderBy: { lastInboundAt: 'asc' }, take: 15 }),
    ]);

    const out: AlertDto[] = [];
    for (const l of unattended) {
      const late = now - l.stageEnteredAt.getTime() > L.unattendedHighHours * H;
      out.push({ id: `unattended:${l.id}`, type: 'LEAD_UNATTENDED', severity: late ? 'high' : 'medium', title: `${l.customer.name} ainda não foi atendido`, description: `Chegou ${ago(l.stageEnteredAt)} e continua na primeira etapa.`, href: `/leads/${l.id}`, since: l.stageEnteredAt.toISOString() });
    }
    for (const l of stale) out.push({ id: `stale:${l.id}`, type: 'LEAD_STALE', severity: 'low', title: `${l.customer.name} está parado`, description: `Em “${l.stage?.name ?? 'etapa'}” ${ago(l.stageEnteredAt).replace('há ', 'há ')} sem avançar.`, href: `/leads/${l.id}`, since: l.stageEnteredAt.toISOString() });
    if (overdue) out.push({ id: 'tasks-overdue', type: 'TASKS_OVERDUE', severity: overdue >= 5 ? 'high' : 'medium', title: `${overdue} ${overdue === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}`, description: 'Resolva ou reagende para os leads não esfriarem.', href: '/tarefas', since: null });
    for (const v of unconfirmed) out.push({ id: `visit-unconfirmed:${v.id}`, type: 'VISIT_UNCONFIRMED', severity: 'medium', title: `Confirme a visita de ${v.lead.customer.name}`, description: `Marcada para ${when(v.scheduledAt)} e ainda sem confirmação.`, href: '/agenda', since: v.scheduledAt.toISOString() });
    for (const v of noOutcome) out.push({ id: `visit-outcome:${v.id}`, type: 'VISIT_NO_OUTCOME', severity: 'medium', title: `Registre como foi a visita de ${v.lead.customer.name}`, description: `Era ${when(v.scheduledAt)}; falta marcar como realizada ou cliente ausente.`, href: '/agenda', since: v.scheduledAt.toISOString() });
    for (const p of expiring) out.push({ id: `proposal-expiring:${p.id}`, type: 'PROPOSAL_EXPIRING', severity: 'high', title: `Proposta de ${p.lead.customer.name} vence em breve`, description: `${p.property.code} · vence ${when(p.validUntil!)}.`, href: `/leads/${p.leadId}`, since: p.validUntil!.toISOString() });
    for (const p of idle) out.push({ id: `proposal-idle:${p.id}`, type: 'PROPOSAL_IDLE', severity: 'low', title: `Proposta de ${p.lead.customer.name} sem movimento`, description: `${p.property.code} · sem novidades ${ago(p.updatedAt)}.`, href: `/leads/${p.leadId}`, since: p.updatedAt.toISOString() });
    for (const c of waiting) out.push({ id: `whatsapp:${c.id}`, type: 'WHATSAPP_WAITING', severity: 'high', title: `${c.lead?.customer.name ?? c.contactName ?? 'Cliente'} espera resposta no WhatsApp`, description: `Última mensagem ${ago(c.lastInboundAt!)}.`, href: `/conversas/${c.id}`, since: c.lastInboundAt!.toISOString() });

    return out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || (a.since ?? '').localeCompare(b.since ?? ''));
  }
}
