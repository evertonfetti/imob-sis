import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  OPEN_PROPOSAL_STATUSES, PROPOSAL_STATUS_LABELS, PROPOSAL_TRANSITIONS,
  type CounterProposalInput, type CreateProposalInput, type ProposalStatus, type UpdateProposalInput,
} from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { LeadsService } from '../crm/leads.service';
import { canViewAll } from '../crm/visibility';
import { PrismaService } from '../prisma/prisma.service';
import { CommercialEvents, type ProposalEvent } from './commercial.events';

const num = (v: unknown) => (v == null ? null : Number(v));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const isOpen = (s: ProposalStatus) => OPEN_PROPOSAL_STATUSES.includes(s);

const include = {
  lead: { select: { id: true, brokerId: true, customer: { select: { id: true, name: true, phone: true, email: true } } } },
  property: { select: { id: true, code: true, title: true, purpose: true, status: true, salePrice: true, rentPrice: true, minimumNegotiationPrice: true, city: true, neighborhood: true } },
  owner: { select: { id: true, name: true, phone: true, whatsapp: true, email: true } },
  revisions: { orderBy: { createdAt: 'asc' as const } },
} as const;

/** Corretores só veem propostas dos leads deles. */
export const proposalScope = (u: AuthedUser) => ({ companyId: u.companyId, ...(canViewAll(u) ? {} : { lead: { brokerId: u.id } }) });

@Injectable()
export class ProposalsService {
  private readonly log = new Logger('Proposals');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly leads: LeadsService,
  ) {}

  private async emit(name: string, e: ProposalEvent) {
    try { await this.events.emitAsync(name, e); } catch (err) { this.log.error(`Falha ao processar ${name}: ${(err as Error).message}`); }
  }

  /** Resposta da API: valores como número; valor mínimo de negociação e proprietário só para quem edita imóveis. */
  private async present(user: AuthedUser, p: Awaited<ReturnType<ProposalsService['loadRaw']>>) {
    const canSeeSensitive = user.permissions.includes('property.edit');
    const ids = [...new Set(p.revisions.map((r) => r.createdById).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids }, companyId: user.companyId }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const asking = num(p.askingPrice)!;
    const proposed = num(p.proposedPrice)!;
    const min = num(p.property.minimumNegotiationPrice);
    const { minimumNegotiationPrice: _m, ...property } = p.property;
    return {
      id: p.id, leadId: p.leadId, propertyId: p.propertyId, status: p.status, conditions: p.conditions, validUntil: p.validUntil?.toISOString() ?? null,
      decidedAt: p.decidedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
      askingPrice: asking, proposedPrice: proposed, downPayment: num(p.downPayment), financingAmount: num(p.financingAmount),
      differencePct: asking > 0 ? (proposed - asking) / asking : 0,
      lead: p.lead, property: { ...property, salePrice: num(p.property.salePrice), rentPrice: num(p.property.rentPrice) },
      ...(canSeeSensitive && { owner: p.owner, minimumNegotiationPrice: min, belowMinimum: min != null && proposed < min }),
      revisions: p.revisions.map((r) => ({ id: r.id, amount: num(r.amount)!, conditions: r.conditions, party: r.party, note: r.note, createdAt: r.createdAt.toISOString(), createdBy: r.createdById ? (names.get(r.createdById) ?? null) : null })),
    };
  }

  private loadRaw(where: object) { return this.prisma.proposal.findFirst({ where, include }).then((p) => { if (!p) throw notFound('Proposta não encontrada.'); return p; }); }
  private async load(user: AuthedUser, id: string) { return this.loadRaw({ id, ...proposalScope(user) }); }
  async get(user: AuthedUser, id: string) { return this.present(user, await this.load(user, id)); }

  async list(user: AuthedUser, q: { page: number; pageSize: number; status?: string; open?: string; leadId?: string; propertyId?: string; search?: string }) {
    const where = {
      ...proposalScope(user),
      ...(q.status && { status: q.status as ProposalStatus }),
      ...(q.open && { status: { in: OPEN_PROPOSAL_STATUSES as never[] } }),
      ...(q.leadId && { leadId: q.leadId }),
      ...(q.propertyId && { propertyId: q.propertyId }),
      ...(q.search && { OR: [{ property: { code: { contains: q.search, mode: 'insensitive' as const } } }, { property: { title: { contains: q.search, mode: 'insensitive' as const } } }, { lead: { customer: { name: { contains: q.search, mode: 'insensitive' as const } } } }] }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.proposal.findMany({ where, include, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.proposal.count({ where }),
    ]);
    return { items: await Promise.all(rows.map((r) => this.present(user, r))), total, page: q.page, pageSize: q.pageSize };
  }

  // ---------- Validações ----------
  private assertMoney(price: number, downPayment?: number | null, financing?: number | null) {
    if ((downPayment != null && downPayment > price) || (financing != null && financing > price)) {
      throw new AppException('PROPOSAL_PRICE_INVALID', 400, 'A entrada e o financiamento não podem ser maiores que o valor da proposta.');
    }
  }

  private assertOpen(p: { status: ProposalStatus }) {
    if (!isOpen(p.status)) throw new AppException('PROPOSAL_CLOSED', 409);
  }

  // ---------- Criação ----------
  async create(ctx: AuthedCtx, input: CreateProposalInput) {
    const { user } = ctx;
    const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, companyId: user.companyId, ...(canViewAll(user) ? {} : { brokerId: user.id }) }, select: { id: true, customerId: true, propertyId: true } });
    if (!lead) throw notFound('Lead não encontrado.');
    const propertyId = input.propertyId ?? lead.propertyId;
    if (!propertyId) throw new AppException('PROPOSAL_PROPERTY_REQUIRED', 400);
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, companyId: user.companyId } });
    if (!property) throw new AppException('PROPERTY_INVALID', 400);
    if (!['AVAILABLE', 'RESERVED'].includes(property.status)) throw new AppException('PROPOSAL_PROPERTY_UNAVAILABLE', 409);
    this.assertMoney(input.proposedPrice, input.downPayment, input.financingAmount);
    if (input.validUntil && new Date(input.validUntil).getTime() < Date.now()) throw new AppException('VALIDATION_FAILED', 400, 'A validade da proposta não pode estar no passado.');

    const asking = num(property.purpose === 'RENT' ? property.rentPrice : property.salePrice) ?? input.proposedPrice;
    const status: ProposalStatus = input.send ? 'SENT' : 'DRAFT';
    const created = await this.prisma.proposal.create({
      data: {
        companyId: user.companyId, leadId: lead.id, propertyId, buyerId: lead.customerId, ownerId: property.ownerId, createdById: user.id,
        askingPrice: asking, proposedPrice: input.proposedPrice, downPayment: input.downPayment ?? null, financingAmount: input.financingAmount ?? null,
        conditions: input.conditions || null, validUntil: input.validUntil ? new Date(input.validUntil) : null, status,
        revisions: { create: { amount: input.proposedPrice, conditions: input.conditions || null, party: 'BUYER', createdById: user.id, note: 'Proposta inicial' } },
      },
    });
    await this.audit.record({ companyId: user.companyId, entity: 'PROPOSAL', entityId: created.id, action: 'CREATE', after: { leadId: lead.id, propertyId, proposedPrice: input.proposedPrice, askingPrice: asking, status }, ctx });
    await this.emit(CommercialEvents.ProposalCreated, {
      companyId: user.companyId, leadId: lead.id, userId: user.id, proposalId: created.id, status, amount: input.proposedPrice,
      title: input.send ? `Proposta de ${brl(input.proposedPrice)} enviada` : `Proposta de ${brl(input.proposedPrice)} salva como rascunho`,
      description: `${property.code} · pedido ${brl(asking)}`, advance: input.send ? 'PROPOSAL' : undefined,
    });
    return this.get(user, created.id);
  }

  // ---------- Edição e mudança de status ----------
  async update(ctx: AuthedCtx, id: string, input: UpdateProposalInput) {
    const { user } = ctx;
    const cur = await this.load(user, id);
    if (cur.status === 'ACCEPTED' && input.status !== 'CANCELLED') throw new AppException('PROPOSAL_CLOSED', 409);
    if (!isOpen(cur.status) && cur.status !== 'ACCEPTED') throw new AppException('PROPOSAL_CLOSED', 409);

    const data: Record<string, unknown> = {};
    const price = num(cur.proposedPrice)!;
    const down = input.downPayment !== undefined ? input.downPayment : num(cur.downPayment);
    const fin = input.financingAmount !== undefined ? input.financingAmount : num(cur.financingAmount);
    this.assertMoney(price, down, fin);
    if (input.downPayment !== undefined) data.downPayment = input.downPayment;
    if (input.financingAmount !== undefined) data.financingAmount = input.financingAmount;
    if (input.conditions !== undefined) data.conditions = input.conditions || null;
    if (input.validUntil !== undefined) data.validUntil = input.validUntil ? new Date(input.validUntil) : null;

    let title: string | null = null;
    let advance: ProposalEvent['advance'];
    let accepted = false;
    if (input.status && input.status !== cur.status) {
      const to = input.status;
      if (to === 'COUNTERED' || to === 'EXPIRED') throw new AppException('PROPOSAL_STATUS_INVALID', 409, to === 'COUNTERED' ? 'Registre a contraproposta com o novo valor.' : 'A expiração é automática, pela validade da proposta.');
      if (!PROPOSAL_TRANSITIONS[cur.status].includes(to)) throw new AppException('PROPOSAL_STATUS_INVALID', 409);
      // Decidir o resultado da negociação é uma responsabilidade de gestão.
      if ((to === 'ACCEPTED' || to === 'REJECTED' || (to === 'CANCELLED' && cur.status === 'ACCEPTED')) && !user.permissions.includes('proposal.manage')) throw new AppException('AUTH_FORBIDDEN', 403);
      data.status = to;
      if (to === 'ACCEPTED' || to === 'REJECTED' || to === 'CANCELLED') data.decidedAt = new Date();
      title = to === 'SENT' ? 'Proposta enviada ao proprietário' : `Proposta ${PROPOSAL_STATUS_LABELS[to].toLowerCase()}`;
      if (to === 'SENT') advance = 'PROPOSAL';
      if (to === 'ACCEPTED') { advance = 'NEGOTIATION'; accepted = true; }
    }
    if (!Object.keys(data).length) return this.present(user, cur);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.proposal.update({ where: { id }, data });
      if (data.status === 'ACCEPTED' && cur.property.status === 'AVAILABLE') await tx.property.update({ where: { id: cur.propertyId }, data: { status: 'RESERVED' } }); // reservado enquanto o negócio não fecha
      if (data.status === 'CANCELLED' && cur.status === 'ACCEPTED' && cur.property.status === 'RESERVED') {
        const other = await tx.proposal.count({ where: { propertyId: cur.propertyId, status: 'ACCEPTED', id: { not: id } } });
        if (!other) await tx.property.update({ where: { id: cur.propertyId }, data: { status: 'AVAILABLE' } });
      }
      return u;
    });
    await this.audit.record({ companyId: user.companyId, entity: 'PROPOSAL', entityId: id, action: data.status ? `STATUS_${data.status}` : 'UPDATE', before: { status: cur.status }, after: { status: updated.status }, ctx });
    if (accepted && cur.property.status === 'AVAILABLE') await this.audit.record({ companyId: user.companyId, entity: 'PROPERTY', entityId: cur.propertyId, action: 'UPDATE', before: { status: 'AVAILABLE' }, after: { status: 'RESERVED' }, ctx });
    await this.emit(accepted ? CommercialEvents.ProposalAccepted : CommercialEvents.ProposalUpdated, {
      companyId: user.companyId, leadId: cur.leadId, userId: user.id, proposalId: id, status: updated.status, amount: price,
      title: title ?? 'Condições da proposta atualizadas', description: cur.property.code, advance,
    });
    return this.get(user, id);
  }

  // ---------- Contraproposta ----------
  async counter(ctx: AuthedCtx, id: string, input: CounterProposalInput) {
    const { user } = ctx;
    const cur = await this.load(user, id);
    if (!isOpen(cur.status) || cur.status === 'ACCEPTED') throw new AppException('PROPOSAL_CLOSED', 409);
    if (cur.status === 'DRAFT') throw new AppException('PROPOSAL_STATUS_INVALID', 409, 'Envie a proposta ao proprietário antes de negociar valores.');
    this.assertMoney(input.amount, num(cur.downPayment), num(cur.financingAmount));

    const next: ProposalStatus = input.party === 'OWNER' ? 'COUNTERED' : 'UNDER_REVIEW';
    await this.prisma.$transaction([
      this.prisma.proposalRevision.create({ data: { proposalId: id, amount: input.amount, conditions: input.conditions || null, party: input.party, note: input.note || null, createdById: user.id } }),
      this.prisma.proposal.update({ where: { id }, data: { proposedPrice: input.amount, status: next, ...(input.conditions !== undefined && { conditions: input.conditions || null }) } }),
    ]);
    await this.audit.record({ companyId: user.companyId, entity: 'PROPOSAL', entityId: id, action: 'COUNTER', before: { proposedPrice: num(cur.proposedPrice), status: cur.status }, after: { proposedPrice: input.amount, status: next, party: input.party }, ctx });
    await this.emit(CommercialEvents.ProposalUpdated, {
      companyId: user.companyId, leadId: cur.leadId, userId: user.id, proposalId: id, status: next, amount: input.amount, advance: 'NEGOTIATION',
      title: input.party === 'OWNER' ? `Contraproposta do proprietário: ${brl(input.amount)}` : `Nova oferta do comprador: ${brl(input.amount)}`,
      description: `${cur.property.code} · anterior ${brl(num(cur.proposedPrice)!)}`,
    });
    return this.get(user, id);
  }

  // ---------- Fechamento ----------
  /** Proposta aceita → negócio fechado: imóvel vendido/alugado, lead ganho (e Purchase à Meta com o valor negociado). */
  async closeDeal(ctx: AuthedCtx, id: string) {
    const { user } = ctx;
    const cur = await this.load(user, id);
    if (cur.status !== 'ACCEPTED') throw new AppException('PROPOSAL_NOT_ACCEPTED', 409);
    const finalStatus = cur.property.purpose === 'RENT' ? 'RENTED' : 'SOLD';

    const others = await this.prisma.proposal.findMany({ where: { propertyId: cur.propertyId, id: { not: id }, status: { in: OPEN_PROPOSAL_STATUSES as never[] } }, select: { id: true, leadId: true } });
    await this.prisma.$transaction([
      this.prisma.property.update({ where: { id: cur.propertyId }, data: { status: finalStatus } }),
      // Outras propostas em aberto para o mesmo imóvel perdem o objeto.
      this.prisma.proposal.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'CANCELLED', decidedAt: new Date() } }),
    ]);
    await this.audit.record({ companyId: user.companyId, entity: 'PROPERTY', entityId: cur.propertyId, action: 'UPDATE', before: { status: cur.property.status }, after: { status: finalStatus }, ctx });
    await this.audit.record({ companyId: user.companyId, entity: 'PROPOSAL', entityId: id, action: 'CLOSE_DEAL', after: { price: num(cur.proposedPrice), propertyStatus: finalStatus, cancelledOthers: others.length }, ctx });
    await this.leads.advanceTo(user.companyId, cur.leadId, 'WON', user.id);
    await this.emit(CommercialEvents.ProposalUpdated, {
      companyId: user.companyId, leadId: cur.leadId, userId: user.id, proposalId: id, status: 'ACCEPTED', amount: num(cur.proposedPrice)!,
      title: `Negócio fechado por ${brl(num(cur.proposedPrice)!)}`, description: `${cur.property.code} · ${finalStatus === 'SOLD' ? 'vendido' : 'alugado'}`,
    });
    for (const o of others) {
      await this.emit(CommercialEvents.ProposalUpdated, { companyId: user.companyId, leadId: o.leadId, userId: user.id, proposalId: o.id, status: 'CANCELLED', amount: 0, title: 'Proposta cancelada', description: 'O imóvel foi fechado em outra negociação.' });
    }
    return this.get(user, id);
  }

  // ---------- Expiração automática ----------
  /** Propostas em aberto com validade vencida viram "expiradas". Retorna quantas mudaram. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.proposal.findMany({ where: { status: { in: OPEN_PROPOSAL_STATUSES as never[] }, validUntil: { lt: now } }, include: { property: { select: { code: true } } } });
    for (const p of due) {
      const res = await this.prisma.proposal.updateMany({ where: { id: p.id, status: { in: OPEN_PROPOSAL_STATUSES as never[] } }, data: { status: 'EXPIRED', decidedAt: now } });
      if (!res.count) continue;
      await this.audit.record({ companyId: p.companyId, userId: null, entity: 'PROPOSAL', entityId: p.id, action: 'STATUS_EXPIRED', before: { status: p.status }, after: { status: 'EXPIRED' } });
      await this.emit(CommercialEvents.ProposalUpdated, { companyId: p.companyId, leadId: p.leadId, userId: null, proposalId: p.id, status: 'EXPIRED', amount: num(p.proposedPrice)!, title: 'Proposta expirada', description: `${p.property.code} · venceu em ${p.validUntil!.toLocaleDateString('pt-BR')}` });
    }
    return due.length;
  }
}
