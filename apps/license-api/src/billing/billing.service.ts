import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BillingInterval, BillingSettingsDto, BillingSettingsInput, InvoiceDto } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedStaff } from '../common/request-context';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoClient } from './mercadopago.client';
import { nextPeriod } from './period';

const BRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateLabel = (d: Date) => d.toLocaleDateString('pt-BR');

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly mp: MercadoPagoClient,
  ) {}

  get configured() {
    return this.mp.configured;
  }

  /** Prazos configuráveis pelo painel master (sem precisar mexer em variável de ambiente nem reiniciar). */
  async getSettings(): Promise<BillingSettingsDto> {
    const row = await this.prisma.billingSettings.upsert({ where: { id: 'singleton' }, create: {}, update: {} });
    return { advanceDays: row.advanceDays, graceDays: row.graceDays, updatedAt: row.updatedAt.toISOString() };
  }

  async updateSettings(input: BillingSettingsInput, staff: AuthedStaff): Promise<BillingSettingsDto> {
    const row = await this.prisma.billingSettings.upsert({ where: { id: 'singleton' }, create: input, update: input });
    await this.log_(null, 'billing_settings_changed', `Prazos de cobrança atualizados: aviso de ${input.advanceDays} dias antes do vencimento, tolerância de ${input.graceDays} dias após vencer.`, staff.id);
    return { advanceDays: row.advanceDays, graceDays: row.graceDays, updatedAt: row.updatedAt.toISOString() };
  }

  private dto(i: { id: string; periodStart: Date; periodEnd: Date; amountCents: number; status: string; dueAt: Date; checkoutUrl: string | null; paidAt: Date | null; createdAt: Date }): InvoiceDto {
    return {
      id: i.id, periodStart: i.periodStart.toISOString(), periodEnd: i.periodEnd.toISOString(), amountCents: i.amountCents,
      status: i.status as InvoiceDto['status'], dueAt: i.dueAt.toISOString(), checkoutUrl: i.checkoutUrl, paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    };
  }

  private async log_(licenseId: string | null, type: string, message: string, staffId?: string) {
    await this.prisma.licenseEvent.create({ data: { licenseId, staffId, type, message } });
  }

  /** Gera a próxima fatura (Checkout Pro: Pix, boleto e cartão no mesmo link). Sem `staff`, é a chamada automática do agendador. */
  async createInvoice(licenseId: string, staff?: AuthedStaff): Promise<InvoiceDto> {
    if (!this.mp.configured) throw new AppException('BILLING_NOT_CONFIGURED', 400);
    const license = await this.prisma.license.findUnique({ where: { id: licenseId }, include: { plan: true, client: true } });
    if (!license) throw notFound('Licença não encontrada.');
    if (license.plan.priceCents <= 0) throw new AppException('BILLING_PLAN_FREE', 400);
    if (await this.prisma.invoice.findFirst({ where: { licenseId, status: 'PENDING' } })) throw new AppException('BILLING_INVOICE_OPEN', 409);

    const { periodStart, periodEnd, dueAt } = nextPeriod(license.plan.billingInterval as BillingInterval, { currentPeriodEnd: license.currentPeriodEnd, trialEndsAt: license.trialEndsAt });
    const invoice = await this.prisma.invoice.create({ data: { licenseId, periodStart, periodEnd, dueAt, amountCents: license.plan.priceCents } });

    try {
      const pref = await this.mp.createPreference({
        title: `${license.plan.name} — ${license.client.name} (até ${dateLabel(periodEnd)})`,
        amountCents: license.plan.priceCents,
        externalReference: invoice.id,
        notificationUrl: `${(this.env.LICENSE_API_PUBLIC_URL ?? '').replace(/\/$/, '')}/webhooks/mercadopago`,
        successUrl: this.env.LICENSE_PANEL_URL,
      });
      const updated = await this.prisma.invoice.update({ where: { id: invoice.id }, data: { mpPreferenceId: pref.id, checkoutUrl: pref.checkoutUrl } });
      await this.log_(licenseId, 'invoice_created', `Fatura de ${BRL(invoice.amountCents)} gerada (vencimento ${dateLabel(dueAt)}).`, staff?.id);
      return this.dto(updated);
    } catch (e) {
      // Sem o link de pagamento a fatura não serve para nada: desfaz para poder tentar de novo depois.
      await this.prisma.invoice.delete({ where: { id: invoice.id } }).catch(() => undefined);
      throw e;
    }
  }

  /** Notificação do Mercado Pago (pagamento aprovado, pendente, rejeitado...). */
  async handleWebhook(dataId: string | undefined, headers: { xSignature?: string; xRequestId?: string }) {
    if (!dataId) return { ok: true }; // evento sem id de pagamento: nada a fazer, mas não é erro do Mercado Pago
    if (!this.mp.verifySignature(headers, dataId)) throw new AppException('BILLING_WEBHOOK_INVALID', 401);

    const payment = await this.mp.getPayment(dataId);
    if (!payment.externalReference) return { ok: true };
    const invoice = await this.prisma.invoice.findUnique({ where: { id: payment.externalReference }, include: { license: true } });
    if (!invoice) return { ok: true };
    if (invoice.status === 'PAID') return { ok: true }; // idempotente: notificação repetida

    if (payment.status !== 'approved') {
      this.log.log(`Pagamento ${payment.id} da fatura ${invoice.id}: status "${payment.status}" (aguardando aprovação ou não aprovado).`);
      return { ok: true };
    }

    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date(), mpPaymentId: payment.id } });
    await this.prisma.license.update({ where: { id: invoice.license.id }, data: { status: 'ACTIVE', suspendedAt: null, suspendReason: null, currentPeriodEnd: invoice.periodEnd } });
    await this.log_(invoice.license.id, 'payment_received', `Pagamento de ${BRL(payment.amountCents)} confirmado. Licença ativa até ${dateLabel(invoice.periodEnd)}.`);
    return { ok: true };
  }

  /** Rotina periódica: gera faturas que estão se aproximando do vencimento e trata as que venceram sem pagamento. */
  async tick(now = new Date()) {
    if (!this.mp.configured) return;
    const { advanceDays, graceDays } = await this.getSettings();

    const dueSoon = await this.prisma.license.findMany({
      where: { billingMode: 'AUTO', status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, plan: { priceCents: { gt: 0 } } },
      include: { plan: true },
    });
    for (const lic of dueSoon) {
      const basis = lic.currentPeriodEnd ?? lic.trialEndsAt;
      if (!basis) continue;
      const daysLeft = (basis.getTime() - now.getTime()) / 86_400_000;
      if (daysLeft > advanceDays) continue;
      if (await this.prisma.invoice.findFirst({ where: { licenseId: lic.id, status: 'PENDING' } })) continue;
      try {
        await this.createInvoice(lic.id);
      } catch (e) {
        this.log.warn(`Não foi possível gerar a fatura automática da licença ${lic.id}: ${(e as Error).message}`);
      }
    }

    const overdue = await this.prisma.invoice.findMany({ where: { status: 'PENDING', dueAt: { lt: now } }, include: { license: true } });
    for (const inv of overdue) {
      const lic = inv.license;
      if (lic.billingMode !== 'AUTO' || lic.status === 'SUSPENDED' || lic.status === 'CANCELED') continue;
      const graceDeadline = new Date(inv.dueAt.getTime() + graceDays * 86_400_000);
      if (now >= graceDeadline) {
        await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: 'EXPIRED' } });
        await this.prisma.license.update({ where: { id: lic.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspendReason: 'Fatura vencida sem pagamento.' } });
        await this.log_(lic.id, 'suspended_unpaid', `Licença suspensa: fatura de ${BRL(inv.amountCents)} vencida em ${dateLabel(inv.dueAt)} sem pagamento.`);
      } else if (lic.status === 'ACTIVE') {
        await this.prisma.license.update({ where: { id: lic.id }, data: { status: 'PAST_DUE' } });
        await this.log_(lic.id, 'past_due', `Fatura de ${BRL(inv.amountCents)} vencida em ${dateLabel(inv.dueAt)}. Prazo de tolerância antes de suspender: ${graceDays} dias.`);
      }
    }
  }
}
