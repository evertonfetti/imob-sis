import { Injectable, Logger } from '@nestjs/common';
import type { MetaEvent } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { MetaApiError } from '../whatsapp/meta.client';
import { MarketingQueue } from './marketing.queue';
import { MetaIntegrationService } from './meta-integration.service';
import { MetaConversionsService, buildEvent, hasIdentifiers, type UserInput } from './meta-conversions.service';

export interface TrackInput { companyId: string; eventName: MetaEvent; leadId?: string; clickId?: string }

const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * Ponto único para registrar conversões. Decide se o evento pode ser enviado (Meta conectada, consentimento,
 * identificadores), grava o histórico e entrega à fila. Nunca bloqueia a operação que gerou o evento.
 */
@Injectable()
export class MarketingService {
  private readonly log = new Logger('Marketing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaIntegrationService,
    private readonly capi: MetaConversionsService,
    private readonly queue: MarketingQueue,
  ) {}

  async track(t: TrackInput): Promise<void> {
    if (!(await this.meta.config(t.companyId))) return; // sem Meta conectada não há o que enviar nem rejeitar

    let user: UserInput;
    let eventId: string;
    let consent = false;
    let actionSource: 'website' | 'system_generated' = 'system_generated';
    let eventSourceUrl: string | null = null;
    let customData: Record<string, unknown> = {};
    let leadId: string | null = null;

    if (t.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: t.leadId },
        include: { customer: true, attribution: true, property: { select: { code: true, title: true, purpose: true, salePrice: true, rentPrice: true } } },
      });
      if (!lead || lead.companyId !== t.companyId) return;
      const a = lead.attribution;
      leadId = lead.id;
      consent = !!a?.marketingConsent;
      user = { email: lead.customer.email, phone: lead.customer.phone, name: lead.customer.name, leadId: lead.id, fbc: a?.fbc, fbp: a?.fbp, clientIp: a?.clientIp, clientUserAgent: a?.clientUserAgent };
      eventId = t.eventName === 'Lead' ? (a?.eventId ?? `lead-${lead.id}`) : `${t.eventName}-${lead.id}`; // determinístico: reentrar na etapa não reenvia
      if (t.eventName === 'Lead' && a?.pageUrl) { actionSource = 'website'; eventSourceUrl = a.pageUrl; }
      if (lead.property) {
        const p = lead.property;
        customData = { content_ids: [p.code], content_name: p.title, content_type: 'home_listing' };
        if (t.eventName === 'Purchase') {
          const value = p.purpose === 'RENT' ? num(p.rentPrice) : num(p.salePrice);
          if (value) customData = { ...customData, currency: 'BRL', value };
        }
      }
    } else if (t.clickId) {
      const click = await this.prisma.whatsAppClick.findUnique({ where: { id: t.clickId } });
      if (!click || click.companyId !== t.companyId) return;
      consent = click.marketingConsent;
      user = { fbc: click.fbc, fbp: click.fbp, clientIp: click.clientIp, clientUserAgent: click.clientUserAgent };
      eventId = click.eventId ?? `contact-${click.id}`;
      actionSource = 'website';
      eventSourceUrl = click.pageUrl;
    } else return;

    // LGPD: sem o "aceito" do visitante no aviso de cookies do site, nada é enviado à Meta.
    const skip = !consent ? 'Sem consentimento de marketing do visitante' : !hasIdentifiers(user) ? 'Sem identificadores do visitante (e-mail, telefone, fbc/fbp)' : null;
    const payload = skip && !consent ? null : buildEvent({ eventName: t.eventName, eventId, eventTime: new Date(), actionSource, eventSourceUrl, user, customData });

    try {
      const row = await this.prisma.marketingEvent.create({
        data: { companyId: t.companyId, leadId, eventName: t.eventName, eventId, status: skip ? 'SKIPPED' : 'PENDING', error: skip, payload: (payload ?? undefined) as never },
      });
      if (!skip) await this.queue.enqueue(row.id);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return; // esse evento já foi registrado
      throw e;
    }
  }

  /** Executado pela fila. Lança erro para a fila tentar de novo (limite de 3). */
  async process(id: string) {
    const ev = await this.prisma.marketingEvent.findUnique({ where: { id } });
    if (!ev || ev.status === 'SENT' || !ev.payload) return;
    const cfg = await this.meta.config(ev.companyId);
    if (!cfg) { await this.markFailed(id, 'Meta desconectada'); return; }
    await this.prisma.marketingEvent.update({ where: { id }, data: { attempts: { increment: 1 } } });
    try {
      const response = await this.capi.sendEvent(cfg, ev.payload as never);
      await this.prisma.marketingEvent.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), response: response as never, error: null } });
    } catch (e) {
      const msg = e instanceof MetaApiError ? e.message : (e as Error).message;
      await this.prisma.marketingEvent.update({ where: { id }, data: { error: msg.slice(0, 300) } });
      throw e;
    }
  }

  async markFailed(id: string, error: unknown) {
    const msg = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    this.log.warn(`Evento ${id} não enviado: ${msg}`);
    await this.prisma.marketingEvent.updateMany({ where: { id, status: { not: 'SENT' } }, data: { status: 'FAILED', error: msg } });
  }

  async retry(companyId: string, id: string) {
    const ev = await this.prisma.marketingEvent.findFirst({ where: { id, companyId } });
    if (!ev) throw notFound('Evento não encontrado.');
    if (ev.status !== 'FAILED' || !ev.payload) throw new AppException('MARKETING_EVENT_NOT_RETRYABLE', 409);
    await this.prisma.marketingEvent.update({ where: { id }, data: { status: 'PENDING', error: null } });
    await this.queue.enqueue(id);
    return this.prisma.marketingEvent.findUniqueOrThrow({ where: { id } });
  }

  /** Evento de teste: aparece em "Testar eventos" no Gerenciador de Eventos da Meta e não é contabilizado. */
  async sendTestEvent(companyId: string) {
    const cfg = await this.meta.config(companyId);
    if (!cfg) throw new AppException('META_NOT_CONFIGURED', 409);
    if (!cfg.testEventCode) throw new AppException('VALIDATION_FAILED', 400, 'Informe o código de teste da Meta (aba "Testar eventos") antes de enviar um evento de teste.');
    try {
      const res = await this.capi.sendEvent(cfg, buildEvent({
        eventName: 'Lead', eventId: `teste-${Date.now()}`, eventTime: new Date(), actionSource: 'system_generated',
        user: { email: 'teste@exemplo.com.br', phone: '11900000000', name: 'Teste Sistema' },
      }));
      return { ok: true, eventsReceived: res.events_received ?? 0, fbtraceId: res.fbtrace_id ?? null };
    } catch (e) {
      throw new AppException('META_TEST_FAILED', 400, `A Meta recusou: ${e instanceof MetaApiError ? e.message : 'sem resposta'}`);
    }
  }
}
