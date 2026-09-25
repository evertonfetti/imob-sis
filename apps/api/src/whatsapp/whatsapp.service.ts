import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolveAgentSettings, type ConversationDto, type MessageDto, type MessageStatus, type SendMessageInput } from '@imob/types';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx, AuthedUser } from '../common/request-context';
import { normalizePhone } from '../common/util';
import { LeadsService } from '../crm/leads.service';
import { canViewAll } from '../crm/visibility';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IntegrationsService } from './integrations.service';
import { MetaApiError } from './meta.client';
import { WhatsappEvents, type WhatsappEvent } from './whatsapp.events';

const WINDOW_MS = 24 * 3_600_000; // janela de atendimento: texto livre só até 24h após a última mensagem do cliente
const SESSION_GAP_MS = 30 * 60_000;
const RANK: Record<string, number> = { RECEIVED: 0, QUEUED: 1, SENT: 2, DELIVERED: 3, READ: 4 };
const STATUS_MAP: Record<string, MessageStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
};
const PROPERTY_CODE = /\bIM\d{4,}\b/i;

type Row = Record<string, any>;

const preview = (s: string | null | undefined, n = 80) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/** Converte uma mensagem do webhook em (tipo, texto, mídia). `null` = ignorar (ex.: reações). */
export function extractContent(m: Row): { type: string; content: string; mediaId?: string; mediaMime?: string } | null {
  const t = String(m.type);
  if (t === 'reaction') return null;
  if (t === 'text') return { type: 'text', content: m.text?.body ?? '' };
  const label: Record<string, string> = { image: '[Imagem]', video: '[Vídeo]', audio: '[Áudio]', document: '[Documento]', sticker: '[Figurinha]' };
  if (label[t]) {
    const media = m[t] ?? {};
    const caption = media.caption ? `${label[t]} ${media.caption}` : media.filename ? `${label[t]} ${media.filename}` : label[t]!;
    return { type: t, content: caption, mediaId: media.id, mediaMime: media.mime_type };
  }
  if (t === 'location') return { type: 'location', content: `Localização: ${m.location?.name ? `${m.location.name} · ` : ''}${m.location?.latitude}, ${m.location?.longitude}` };
  if (t === 'interactive') return { type: 'interactive', content: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[Resposta interativa]' };
  if (t === 'button') return { type: 'button', content: m.button?.text ?? '[Botão]' };
  if (t === 'contacts') return { type: 'contacts', content: '[Contato compartilhado]' };
  return { type: 'unsupported', content: '[Mensagem não suportada]' };
}

@Injectable()
export class WhatsappService {
  private readonly log = new Logger('WhatsApp');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly leads: LeadsService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  private async emit(name: string, payload: WhatsappEvent) {
    try { await this.events.emitAsync(name, payload); } catch (e) { this.log.error(`Falha ao processar ${name}: ${(e as Error).message}`); }
  }

  // ====================================================================
  // Webhook
  // ====================================================================

  /** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com o segredo do app). */
  private validSignature(raw: Buffer | undefined, header: string | undefined, secret: string) {
    if (!raw || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
    const given = Buffer.from(header.slice(7));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async processWebhook(body: Row, raw: Buffer | undefined, signature: string | undefined) {
    if (body?.object !== 'whatsapp_business_account') return;
    const verified = new Map<string, { companyId: string } | null>();
    let failures = 0;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value ?? {};
        const phoneId = String(value.metadata?.phone_number_id ?? '');
        if (!phoneId) continue;

        if (!verified.has(phoneId)) {
          const intg = await this.integrations.byPhoneNumberId(phoneId);
          if (!intg) { this.log.warn(`Webhook para número não cadastrado: ${phoneId}`); verified.set(phoneId, null); }
          else if (!this.validSignature(raw, signature, intg.appSecret)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 401);
          else verified.set(phoneId, { companyId: intg.companyId });
        }
        const company = verified.get(phoneId);
        if (!company) continue; // número desconhecido: responde 200 para a Meta não insistir

        const names = new Map<string, string>((value.contacts ?? []).map((c: Row) => [String(c.wa_id), c.profile?.name as string]));
        for (const m of value.messages ?? []) {
          try { await this.handleInbound(company.companyId, names, m); } catch (e) { failures++; this.log.error(`Falha ao processar mensagem ${m?.id}: ${(e as Error).message}`); }
        }
        for (const s of value.statuses ?? []) {
          try { await this.handleStatus(company.companyId, s); } catch (e) { failures++; this.log.error(`Falha ao processar status ${s?.id}: ${(e as Error).message}`); }
        }
      }
    }
    // Erro transitório → 500 faz a Meta reenviar; a idempotência (wamid único) evita duplicar.
    if (failures) throw new Error(`${failures} item(ns) do webhook falharam`);
  }

  private async handleInbound(companyId: string, names: Map<string, string>, m: Row) {
    const parsed = extractContent(m);
    if (!parsed || !m.id || !m.from) return;
    if (await this.prisma.message.findUnique({ where: { companyId_externalId: { companyId, externalId: m.id } }, select: { id: true } })) return; // já processada

    const phone = normalizePhone(String(m.from));
    const profileName = names.get(String(m.from)) ?? null;
    const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
    const codeMatch = parsed.content.match(PROPERTY_CODE);

    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        let customer = await tx.customer.findFirst({ where: { companyId, phone }, orderBy: { createdAt: 'asc' } });
        customer ??= await tx.customer.create({ data: { companyId, name: profileName ?? phone, phone, whatsapp: phone } });

        let conv = await tx.conversation.findUnique({ where: { companyId_channel_externalId: { companyId, channel: 'WHATSAPP', externalId: String(m.from) } } });
        const property = codeMatch ? await tx.property.findFirst({ where: { companyId, code: codeMatch[0].toUpperCase() }, select: { id: true, code: true, purpose: true, city: true, neighborhood: true, bedrooms: true, brokerId: true } }) : null;

        // Lead: o da conversa (se ainda aberto) → o lead aberto mais recente do cliente → um lead novo.
        let lead: Row | null = conv?.leadId ? await tx.lead.findFirst({ where: { id: conv.leadId, companyId, stage: { type: 'OPEN' } } }) : null;
        lead ??= await tx.lead.findFirst({ where: { companyId, customerId: customer.id, stage: { type: 'OPEN' } }, orderBy: { createdAt: 'desc' } });

        let created: Awaited<ReturnType<LeadsService['createLead']>> | null = null;
        if (!lead) {
          // Se o visitante clicou no WhatsApp do site pouco antes, herdamos a origem da campanha dele.
          const click = property
            ? await tx.whatsAppClick.findFirst({ where: { companyId, propertyId: property.id, leadId: null, createdAt: { gte: new Date(Date.now() - 3 * 3_600_000) } }, orderBy: { createdAt: 'desc' } })
            : null;
          created = await this.leads.createLead(tx, {
            companyId, customerId: customer.id, propertyId: property?.id ?? null, source: 'WHATSAPP', notes: preview(parsed.content, 500),
            propertyDefaults: property ? { ...property } : undefined,
            attribution: click ? {
              utmSource: click.utmSource, utmMedium: click.utmMedium, utmCampaign: click.utmCampaign, utmContent: click.utmContent, utmTerm: click.utmTerm,
              fbclid: click.fbclid, fbc: click.fbc, fbp: click.fbp, gclid: click.gclid, landingPage: click.landingPage, referrer: click.referrer,
              clientIp: click.clientIp, clientUserAgent: click.clientUserAgent, eventId: click.eventId, pageUrl: click.pageUrl, marketingConsent: click.marketingConsent,
            } as never : undefined,
          });
          lead = created.lead;
          if (click) await tx.whatsAppClick.update({ where: { id: click.id }, data: { leadId: lead.id } });
        } else if (property && !lead.propertyId) {
          await tx.lead.update({ where: { id: lead.id }, data: { propertyId: property.id } });
        }

        // Volta para o agente de IA quando: a conversa estava encerrada, ou uma pessoa atendia e a conversa ficou parada além do prazo configurado.
        let reopened = conv?.status === 'CLOSED';
        if (!reopened && conv?.handler === 'HUMAN' && conv.lastMessageAt) {
          const cfg = resolveAgentSettings((await tx.company.findUnique({ where: { id: companyId }, select: { agentSettings: true } }))?.agentSettings);
          reopened = cfg.enabled && cfg.returnToBotAfterHours > 0 && at.getTime() - conv.lastMessageAt.getTime() > cfg.returnToBotAfterHours * 3_600_000;
        }
        const sessionStart = !conv?.lastInboundAt || at.getTime() - conv.lastInboundAt.getTime() > SESSION_GAP_MS;
        const convData = {
          leadId: lead.id, customerId: customer.id, contactName: profileName ?? conv?.contactName ?? customer.name, status: 'OPEN' as const,
          lastMessageAt: at, lastInboundAt: at, lastMessagePreview: preview(parsed.content),
          ...(reopened && { handler: 'BOT' as const, botReplies: 0, handoffReason: null, handlerChangedAt: at }),
        };
        conv = conv
          ? await tx.conversation.update({ where: { id: conv.id }, data: { ...convData, unreadCount: { increment: 1 } } })
          : await tx.conversation.create({ data: { ...convData, companyId, channel: 'WHATSAPP', externalId: String(m.from), unreadCount: 1 } });

        const msg = await tx.message.create({
          data: {
            companyId, conversationId: conv.id, direction: 'INBOUND', externalId: m.id, type: parsed.type, content: parsed.content,
            mediaId: parsed.mediaId ?? null, mediaMime: parsed.mediaMime ?? null, status: 'RECEIVED', sentAt: at, createdAt: at,
          },
        });
        return { conversationId: conv.id, leadId: lead.id, messageId: msg.id, sessionStart, created, text: parsed.content };
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return; // outra entrega da mesma mensagem venceu a corrida
      throw e;
    }

    if (result.created) await this.leads.emitCreated(result.created);
    await this.emit(WhatsappEvents.Received, {
      companyId, leadId: result.leadId, userId: null, conversationId: result.conversationId, preview: preview(result.text), sessionStart: result.sessionStart,
    });
  }

  private async handleStatus(companyId: string, s: Row) {
    const next = STATUS_MAP[String(s.status)];
    if (!next || !s.id) return;
    const msg = await this.prisma.message.findUnique({ where: { companyId_externalId: { companyId, externalId: s.id } } });
    if (!msg || msg.direction !== 'OUTBOUND') return;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();

    if (next === 'FAILED') {
      if (msg.status === 'DELIVERED' || msg.status === 'READ') return; // já entregue: um "failed" atrasado não desfaz
      const err = s.errors?.[0];
      await this.prisma.message.update({ where: { id: msg.id }, data: { status: 'FAILED', error: preview(err?.error_data?.details ?? err?.message ?? err?.title ?? 'Falha na entrega', 300) } });
      return;
    }
    if ((RANK[next] ?? 0) <= (RANK[msg.status] ?? 0)) return; // status fora de ordem não regride
    await this.prisma.message.update({
      where: { id: msg.id },
      data: {
        status: next, error: null,
        ...(next === 'SENT' && { sentAt: msg.sentAt ?? at }),
        ...(next === 'DELIVERED' && { deliveredAt: at, sentAt: msg.sentAt ?? at }),
        ...(next === 'READ' && { readAt: at, deliveredAt: msg.deliveredAt ?? at, sentAt: msg.sentAt ?? at }),
      },
    });
  }

  // ====================================================================
  // Consulta
  // ====================================================================
  private scope(user: AuthedUser) {
    return { companyId: user.companyId, ...(canViewAll(user) ? {} : { lead: { brokerId: user.id } }) };
  }

  private dto(c: Row): ConversationDto {
    const last = c.lastInboundAt as Date | null;
    const open = !!last && Date.now() - last.getTime() < WINDOW_MS;
    return {
      id: c.id, contactName: c.contactName, phone: c.externalId, status: c.status, handler: c.handler, handoffReason: c.handoffReason ?? null, unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null, lastMessagePreview: c.lastMessagePreview,
      windowOpen: open, windowClosesAt: open && last ? new Date(last.getTime() + WINDOW_MS).toISOString() : null,
      lead: c.lead ? { id: c.lead.id, stage: c.lead.stage ?? null, broker: c.lead.broker ?? null, property: c.lead.property ?? null } : null,
    };
  }

  private leadInclude = {
    lead: { select: { id: true, stage: { select: { name: true, color: true } }, broker: { select: { id: true, name: true } }, property: { select: { id: true, code: true } } } },
  } as const;

  async list(user: AuthedUser, q: { page: number; pageSize: number; search?: string; unread?: string; leadId?: string }) {
    const where = {
      ...this.scope(user),
      ...(q.leadId && { leadId: q.leadId }),
      ...(q.unread && { unreadCount: { gt: 0 } }),
      ...(q.search && { OR: [{ contactName: { contains: q.search, mode: 'insensitive' as const } }, { externalId: { contains: q.search.replace(/\D/g, '') || q.search } }] }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where, include: this.leadInclude, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }],
        skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return { items: rows.map((r) => this.dto(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async unreadTotal(user: AuthedUser) {
    const r = await this.prisma.conversation.aggregate({ where: this.scope(user), _sum: { unreadCount: true } });
    return { unread: r._sum.unreadCount ?? 0 };
  }

  private async load(user: AuthedUser, id: string) {
    const c = await this.prisma.conversation.findFirst({ where: { id, ...this.scope(user) }, include: this.leadInclude });
    if (!c) throw notFound('Conversa não encontrada.');
    return c;
  }

  async messageDtos(companyId: string, rows: Row[]): Promise<MessageDto[]> {
    const ids = [...new Set(rows.map((r) => r.sentByUserId).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((m) => ({
      id: m.id, direction: m.direction, type: m.type, content: m.content, hasMedia: !!m.mediaId || !!m.mediaKey, mediaMime: m.mediaMime,
      mediaUrl: m.mediaKey ? this.storage.publicUrl(m.mediaKey) : null, status: m.status, error: m.error,
      sentBy: m.sentByUserId ? (names.get(m.sentByUserId) ?? null) : null, sentByBot: !!m.sentByBot,
      createdAt: m.createdAt.toISOString(), sentAt: m.sentAt?.toISOString() ?? null, deliveredAt: m.deliveredAt?.toISOString() ?? null, readAt: m.readAt?.toISOString() ?? null,
    }));
  }

  async get(user: AuthedUser, id: string) {
    const c = await this.load(user, id);
    const rows = await this.prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { ...this.dto(c), messages: await this.messageDtos(user.companyId, rows.reverse()) };
  }

  async markRead(user: AuthedUser, id: string) {
    const c = await this.load(user, id);
    if (c.unreadCount === 0) return { ok: true };
    await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    const last = await this.prisma.message.findFirst({ where: { conversationId: id, direction: 'INBOUND', externalId: { not: null } }, orderBy: { createdAt: 'desc' } });
    if (last?.externalId) {
      try { await (await this.integrations.clientFor(user.companyId)).markRead(last.externalId); } catch { /* "lido" do lado do cliente é opcional */ }
    }
    return { ok: true };
  }

  // ====================================================================
  // Envio
  // ====================================================================
  async send(ctx: AuthedCtx, conversationId: string, input: SendMessageInput) {
    const c = await this.load(ctx.user, conversationId);
    if (!(await this.integrations.isConnected(ctx.user.companyId))) throw new AppException('WHATSAPP_NOT_CONFIGURED', 409);
    if (input.text) {
      const last = c.lastInboundAt;
      if (!last || Date.now() - last.getTime() > WINDOW_MS) throw new AppException('WHATSAPP_WINDOW_CLOSED', 422);
    }
    // Quando uma pessoa responde, o robô sai da conversa (até alguém devolver ou a conversa ser encerrada).
    if (c.handler === 'BOT') await this.setHandler(c.id, 'HUMAN', `${ctx.user.name ?? 'Um corretor'} assumiu a conversa`);
    const isTemplate = !!input.template;
    const msg = await this.prisma.message.create({
      data: {
        companyId: ctx.user.companyId, conversationId, direction: 'OUTBOUND', type: isTemplate ? 'template' : 'text', status: 'QUEUED', sentByUserId: ctx.user.id,
        content: isTemplate ? `[Modelo] ${input.template!.name}${input.template!.params?.length ? ` — ${input.template!.params.join(' · ')}` : ''}` : input.text,
        payload: isTemplate ? input.template : undefined,
      },
    });
    return this.deliver(ctx.user.companyId, ctx.user.id, c, msg);
  }

  async retry(ctx: AuthedCtx, messageId: string) {
    const msg = await this.prisma.message.findFirst({ where: { id: messageId, companyId: ctx.user.companyId } });
    if (!msg) throw notFound('Mensagem não encontrada.');
    if (msg.direction !== 'OUTBOUND' || msg.status !== 'FAILED') throw new AppException('MESSAGE_NOT_RETRYABLE', 409);
    const c = await this.load(ctx.user, msg.conversationId);
    if (msg.type === 'text' && (!c.lastInboundAt || Date.now() - c.lastInboundAt.getTime() > WINDOW_MS)) throw new AppException('WHATSAPP_WINDOW_CLOSED', 422);
    await this.prisma.message.update({ where: { id: msg.id }, data: { status: 'QUEUED', error: null } });
    return this.deliver(ctx.user.companyId, ctx.user.id, c, msg);
  }

  private async deliver(companyId: string, userId: string | null, c: Row, msg: Row) {
    const client = await this.integrations.clientFor(companyId);
    try {
      const tpl = msg.type === 'template' ? (msg.payload as { name: string; language: string; params?: string[] }) : null;
      const wamid = tpl ? await client.sendTemplate(c.externalId, tpl.name, tpl.language, tpl.params)
        : msg.type === 'image' ? await client.sendImage(c.externalId, (msg.payload as { link: string }).link, msg.content ?? undefined)
        : await client.sendText(c.externalId, msg.content);
      const now = new Date();
      const updated = await this.prisma.message.update({ where: { id: msg.id }, data: { externalId: wamid, status: 'SENT', sentAt: now, error: null } });
      await this.prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: now, lastMessagePreview: preview(msg.content) } });
      if (c.leadId) {
        const recentOut = await this.prisma.message.count({ where: { conversationId: c.id, direction: 'OUTBOUND', id: { not: msg.id }, createdAt: { gte: new Date(Date.now() - SESSION_GAP_MS) } } });
        await this.emit(WhatsappEvents.Sent, { companyId, leadId: c.leadId, userId, conversationId: c.id, preview: preview(msg.content), sessionStart: recentOut === 0 });
      }
      return (await this.messageDtos(companyId, [updated]))[0]!;
    } catch (e) {
      const reason = e instanceof MetaApiError ? e.message : 'Erro de conexão com a Meta';
      await this.prisma.message.update({ where: { id: msg.id }, data: { status: 'FAILED', error: preview(reason, 300) } });
      throw new AppException('WHATSAPP_SEND_FAILED', 502, `Não foi possível enviar: ${reason}`);
    }
  }

  // ====================================================================
  // Quem atende (robô ou pessoa)
  // ====================================================================
  private setHandler(id: string, handler: 'BOT' | 'HUMAN', reason: string | null) {
    return this.prisma.conversation.update({ where: { id }, data: { handler, handoffReason: handler === 'HUMAN' ? reason : null, handlerChangedAt: new Date(), ...(handler === 'BOT' && { botReplies: 0 }) } });
  }

  /** Uma pessoa assume: o agente de IA deixa de responder. */
  async takeover(ctx: AuthedCtx, id: string) {
    const c = await this.load(ctx.user, id);
    if (c.handler !== 'HUMAN') await this.setHandler(id, 'HUMAN', `${ctx.user.name ?? 'Um corretor'} assumiu a conversa`);
    return this.get(ctx.user, id);
  }

  /** Devolve ao agente: ele volta a responder na próxima mensagem do cliente (não puxa assunto sozinho). */
  async returnToBot(ctx: AuthedCtx, id: string) {
    const c = await this.load(ctx.user, id);
    if (c.handler !== 'BOT') await this.setHandler(id, 'BOT', null);
    return this.get(ctx.user, id);
  }

  /** Marca a conversa como finalizada. Se o cliente escrever de novo, ela reabre e o agente volta a atender. */
  async close(ctx: AuthedCtx, id: string) {
    await this.load(ctx.user, id);
    await this.prisma.conversation.update({ where: { id }, data: { status: 'CLOSED', unreadCount: 0 } });
    return this.get(ctx.user, id);
  }

  async reopen(ctx: AuthedCtx, id: string) {
    await this.load(ctx.user, id);
    await this.prisma.conversation.update({ where: { id }, data: { status: 'OPEN' } });
    return this.get(ctx.user, id);
  }

  /** Envio feito pelo agente de IA (texto ou foto por link). Não muda quem atende. Falha de envio só é registrada. */
  async sendAsBot(companyId: string, conversationId: string, m: { text?: string; image?: { url: string; caption?: string; mediaKey?: string | null }; ai?: object }): Promise<boolean> {
    const c = await this.prisma.conversation.findFirst({ where: { id: conversationId, companyId } });
    if (!c) return false;
    const isImage = !!m.image;
    const msg = await this.prisma.message.create({
      data: {
        companyId, conversationId, direction: 'OUTBOUND', type: isImage ? 'image' : 'text', status: 'QUEUED', sentByBot: true,
        content: isImage ? (m.image!.caption ?? '[Imagem]') : m.text, mediaKey: m.image?.mediaKey ?? null, mediaMime: isImage ? 'image/webp' : null,
        payload: { ...(isImage && { link: m.image!.url }), ai: m.ai ?? {} } as never,
      },
    });
    try { await this.deliver(companyId, null, c, msg); return true; } catch { return false; }
  }

  // ====================================================================
  // Mídia recebida (baixada sob demanda e guardada no nosso storage)
  // ====================================================================
  async media(user: AuthedUser, messageId: string) {
    const msg = await this.prisma.message.findFirst({ where: { id: messageId, companyId: user.companyId } });
    if (!msg?.mediaId && !msg?.mediaKey) throw notFound('Esta mensagem não tem arquivo.');
    await this.load(user, msg.conversationId); // valida a visibilidade da conversa
    if (msg.mediaKey) return { url: this.storage.publicUrl(msg.mediaKey), mime: msg.mediaMime };
    try {
      const { buffer, mime } = await (await this.integrations.clientFor(user.companyId)).downloadMedia(msg.mediaId!);
      const ext = EXT[mime.split(';')[0]!] ?? 'bin';
      const key = `${user.companyId}/whatsapp/${msg.conversationId}/${randomUUID()}.${ext}`;
      await this.storage.write(key, buffer, mime);
      await this.prisma.message.update({ where: { id: msg.id }, data: { mediaKey: key, mediaMime: mime } });
      return { url: this.storage.publicUrl(key), mime };
    } catch (e) {
      if (e instanceof AppException) throw e;
      throw new AppException('WHATSAPP_MEDIA_UNAVAILABLE', 502);
    }
  }
}
