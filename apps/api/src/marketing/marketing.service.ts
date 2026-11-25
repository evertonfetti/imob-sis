import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { MetaEvent, PixelMirrorInput } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { MetaApiError } from '../whatsapp/meta.client';
import { MarketingQueue } from './marketing.queue';
import { MetaIntegrationService, type MetaConfig } from './meta-integration.service';
import { MetaConversionsService, buildEvent, hasIdentifiers, type CapiEvent, type UserInput } from './meta-conversions.service';

export interface TrackInput { companyId: string; eventName: MetaEvent; leadId?: string; clickId?: string }

const num = (v: unknown) => (v == null ? null : Number(v));

/** A Meta rejeita eventos com mais de 7 dias: usamos a hora real da ação enquanto ela é aceita. */
const eventTimeOf = (at: Date | null | undefined) => (at && Date.now() - at.getTime() < 6 * 86_400_000 ? at : new Date());

/** Parâmetros que o site pode enviar junto com o evento de navegação (o resto é descartado). */
const MIRROR_PARAMS = ['content_ids', 'content_name', 'content_type', 'content_category', 'value', 'currency', 'search_string', 'contact_method', 'method', 'position', 'city', 'region', 'results'];
const MIRROR_FLUSH_MS = 2000;
const MIRROR_BATCH = 100;

/**
 * Ponto único para registrar conversões. Decide se o evento pode ser enviado (Meta conectada, consentimento,
 * identificadores), grava o histórico e entrega à fila. Nunca bloqueia a operação que gerou o evento.
 */
@Injectable()
export class MarketingService implements OnModuleDestroy {
  private readonly log = new Logger('Marketing');
  // Eventos de navegação esperam até 2 s e vão à Meta em lote (uma chamada por Pixel), sem sobrecarregar a API.
  private readonly buffers = new Map<string, { cfg: MetaConfig; events: ReturnType<typeof buildEvent>[] }>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaIntegrationService,
    private readonly capi: MetaConversionsService,
    private readonly queue: MarketingQueue,
  ) {}

  async track(t: TrackInput): Promise<void> {
    const cfgs = await this.meta.configs(t.companyId);
    if (!cfgs.length) return; // sem Meta conectada não há o que enviar nem rejeitar

    let user: UserInput;
    let eventId: string;
    let consent = false;
    let actionSource: 'website' | 'system_generated' = 'system_generated';
    let eventSourceUrl: string | null = null;
    let customData: Record<string, unknown> = {};
    let leadId: string | null = null;
    let eventTime = new Date();

    if (t.leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: t.leadId },
        include: { customer: true, attribution: true, property: { select: { code: true, title: true, purpose: true, salePrice: true, rentPrice: true } } },
      });
      if (!lead || lead.companyId !== t.companyId) return;
      const a = lead.attribution;
      leadId = lead.id;
      consent = !!a?.marketingConsent;
      user = { email: lead.customer.email, phone: lead.customer.phone, name: lead.customer.name, leadId: lead.id, visitorId: a?.visitorId, fbc: a?.fbc, fbp: a?.fbp, clientIp: a?.clientIp, clientUserAgent: a?.clientUserAgent };
      eventId = t.eventName === 'Lead' ? (a?.eventId ?? `lead-${lead.id}`) : `${t.eventName}-${lead.id}`; // determinístico: reentrar na etapa não reenvia
      if (t.eventName === 'Lead') eventTime = eventTimeOf(lead.createdAt);
      if (t.eventName === 'Lead' && a?.pageUrl) { actionSource = 'website'; eventSourceUrl = a.pageUrl; }
      if (lead.property) {
        const p = lead.property;
        customData = { content_ids: [p.code], content_name: p.title, content_type: 'home_listing' };
        if (t.eventName === 'Purchase') {
          // Valor real do negócio (proposta aceita); sem proposta, o preço anunciado.
          const deal = await this.prisma.proposal.findFirst({ where: { leadId: lead.id, companyId: t.companyId, status: 'ACCEPTED' }, orderBy: { decidedAt: 'desc' }, select: { proposedPrice: true } });
          const value = deal ? num(deal.proposedPrice) : p.purpose === 'RENT' ? num(p.rentPrice) : num(p.salePrice);
          if (value) customData = { ...customData, currency: 'BRL', value };
        }
      }
    } else if (t.clickId) {
      const click = await this.prisma.whatsAppClick.findUnique({ where: { id: t.clickId } });
      if (!click || click.companyId !== t.companyId) return;
      consent = click.marketingConsent;
      eventTime = eventTimeOf(click.createdAt);
      user = { visitorId: click.visitorId, fbc: click.fbc, fbp: click.fbp, clientIp: click.clientIp, clientUserAgent: click.clientUserAgent };
      eventId = click.eventId ?? `contact-${click.id}`;
      actionSource = 'website';
      eventSourceUrl = click.pageUrl;
    } else return;

    // LGPD: sem o "aceito" do visitante no aviso de cookies do site, nada é enviado à Meta.
    const skip = !consent ? 'Sem consentimento de marketing do visitante' : !hasIdentifiers(user) ? 'Sem identificadores do visitante (e-mail, telefone, fbc/fbp)' : null;
    const payload = skip && !consent ? null : buildEvent({ eventName: t.eventName, eventId, eventTime, actionSource, eventSourceUrl, user, customData });

    // Um registro por Pixel (mesmo event_id em todos). Evento ignorado vira um único registro, sem Pixel.
    const targets = skip ? [''] : cfgs.map((c) => c.pixelId);
    for (const pixelId of targets) {
      try {
        const row = await this.prisma.marketingEvent.create({
          data: { companyId: t.companyId, leadId, eventName: t.eventName, eventId, pixelId, status: skip ? 'SKIPPED' : 'PENDING', error: skip, payload: (payload ?? undefined) as never },
        });
        if (!skip) await this.queue.enqueue(row.id);
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') continue; // esse evento já foi registrado para este Pixel
        throw e;
      }
    }
  }

  /**
   * Espelha no servidor um evento que o Pixel disparou no navegador, com o MESMO event_id: a Meta conta uma
   * vez só (deduplicação) e ganha IP, navegador, fbp/fbc e external_id, que melhoram a correspondência e
   * seguem valendo quando o navegador bloqueia o Pixel. O site só chama isto quando o visitante aceitou os cookies.
   */
  async mirror(companyId: string, input: PixelMirrorInput, ctx: { ip?: string; userAgent?: string }) {
    const cfgs = await this.meta.configs(companyId);
    if (!cfgs.length) return;
    const customData: Record<string, unknown> = {};
    for (const k of MIRROR_PARAMS) if (input.params?.[k] !== undefined) customData[k] = input.params[k];
    const user: UserInput = { visitorId: input.visitorId, fbc: input.fbc, fbp: input.fbp, clientIp: ctx.ip, clientUserAgent: ctx.userAgent };
    const base: CapiEvent = { eventName: input.name, eventId: input.eventId, eventTime: new Date(), actionSource: 'website', eventSourceUrl: input.pageUrl, user, customData };
    const event = buildEvent(base);
    for (const cfg of cfgs) {
      const buf = this.buffers.get(cfg.id) ?? { cfg, events: [] };
      buf.cfg = cfg;
      buf.events.push(event);
      this.buffers.set(cfg.id, buf);
      if (buf.events.length >= MIRROR_BATCH) void this.flushMirror();
    }
    this.timer ??= setTimeout(() => void this.flushMirror(), MIRROR_FLUSH_MS);
  }

  private async flushMirror() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batches = [...this.buffers.values()];
    this.buffers.clear();
    await Promise.all(batches.map(async ({ cfg, events }) => {
      try { await this.capi.sendEvents({ pixelId: cfg.pixelId, accessToken: cfg.accessToken }, events); } catch (e) {
        this.log.warn(`Eventos de navegação não enviados ao Pixel ${cfg.pixelId}: ${e instanceof MetaApiError ? e.message : (e as Error).message}`);
      }
    }));
  }

  async onModuleDestroy() { await this.flushMirror(); }

  /** Executado pela fila. Lança erro para a fila tentar de novo (limite de 3). */
  async process(id: string) {
    const ev = await this.prisma.marketingEvent.findUnique({ where: { id } });
    if (!ev || ev.status === 'SENT' || !ev.payload) return;
    const cfg = await this.meta.configByPixelId(ev.companyId, ev.pixelId);
    if (!cfg) { await this.markFailed(id, 'Pixel desativado, removido ou sem token'); return; }
    await this.prisma.marketingEvent.update({ where: { id }, data: { attempts: { increment: 1 } } });
    try {
      const response = await this.capi.sendEvent({ pixelId: cfg.pixelId, accessToken: cfg.accessToken }, ev.payload as never);
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
  async sendTestEvent(companyId: string, id: string) {
    const cfg = await this.meta.config(companyId, id);
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
