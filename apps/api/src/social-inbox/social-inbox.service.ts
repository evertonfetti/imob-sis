import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { resolveAgentSettings } from '@imob/types';
import { AppException } from '../common/app-exception';
import { LeadsService } from '../crm/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SocialAccountsService } from '../social/social-accounts.service';
import { SocialApiError } from '../social/social.client';
import { SocialInboxEvents, type SocialInboxEvent } from './social-inbox.events';

const SESSION_GAP_MS = 30 * 60_000;
const PROPERTY_CODE = /\bIM\d{4,}\b/i;
const ATTACHMENT_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf' };
// A URL do anexo vem do corpo do webhook (JSON), não de algo que escolhemos — tratamos como não confiável e só
// buscamos se for mesmo um domínio de CDN da Meta, resolvendo para um IP público (nunca rede interna/loopback).
const ATTACHMENT_HOST_SUFFIXES = ['.fbcdn.net', '.fbsbx.com', '.cdninstagram.com'];
const MAX_REDIRECTS = 5;

function isPrivateOrLoopbackIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === '::1' || low === '::' || low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('::ffff:127.') || low.startsWith('::ffff:10.') || low.startsWith('::ffff:192.168.');
  }
  return true; // formato não reconhecido: trata como inseguro
}

/** Valida host (lista de CDNs da Meta) e protocolo, e confere que o DNS não resolve para uma rede interna. */
async function assertSafeAttachmentUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error(`protocolo não permitido: ${u.protocol}`);
  if (u.username || u.password) throw new Error('URL com credenciais embutidas não é permitida');
  if (!ATTACHMENT_HOST_SUFFIXES.some((suf) => u.hostname === suf.slice(1) || u.hostname.endsWith(suf))) throw new Error(`host fora da lista de CDNs da Meta: ${u.hostname}`);
  const records = await dns.lookup(u.hostname, { all: true });
  if (!records.length || records.some((r) => isPrivateOrLoopbackIp(r.address))) throw new Error(`host resolve para um endereço não público: ${u.hostname}`);
  return u;
}

/** Busca o anexo sem seguir redirecionamentos automaticamente — cada salto é revalidado (host + DNS) antes de seguir. */
async function fetchAttachmentSafely(rawUrl: string): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const u = await assertSafeAttachmentUrl(current);
    const res = await fetch(u.toString(), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    current = new URL(location, u).toString();
  }
  throw new Error('excesso de redirecionamentos ao buscar o anexo');
}

type Row = Record<string, any>;

const preview = (s: string | null | undefined, n = 80) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

/** Converte um item de `entry[].messaging[]` do Messenger/Instagram. `null` = ignorar (eco do próprio envio, postback…). */
export function extractContent(m: Row): { type: string; content: string; attachmentUrl?: string } | null {
  const msg = m.message;
  if (!msg || msg.is_echo || !msg.mid) return null;
  const att = msg.attachments?.[0];
  if (att?.payload?.url) {
    const label: Record<string, string> = { image: '[Imagem]', video: '[Vídeo]', audio: '[Áudio]' };
    const tag = label[att.type] ?? '[Arquivo]';
    return { type: att.type ?? 'file', content: msg.text ? `${tag} ${msg.text}` : tag, attachmentUrl: att.payload.url };
  }
  if (typeof msg.text === 'string' && msg.text.trim()) return { type: 'text', content: msg.text };
  return null;
}

/**
 * Inbox do Messenger (Facebook) e do Instagram Direct. Mesmas tabelas Conversation/Message do WhatsApp — só a forma
 * de receber (webhook `page`/`instagram`) e de enviar (Send API da Meta) é diferente. O WhatsappService chama este
 * serviço para entregar mensagens de conversas que não são do WhatsApp, reaproveitando toda a tela de "Conversas".
 */
@Injectable()
export class SocialInboxService {
  private readonly log = new Logger('SocialInbox');

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: SocialAccountsService,
    private readonly leads: LeadsService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  private async emit(name: string, payload: SocialInboxEvent) {
    try { await this.events.emitAsync(name, payload); } catch (e) { this.log.error(`Falha ao processar ${name}: ${(e as Error).message}`); }
  }

  // ====================================================================
  // Verificação do webhook (GET)
  // ====================================================================
  async verify(mode: string | undefined, token: string | undefined): Promise<boolean> {
    return mode === 'subscribe' && !!token && (await this.accounts.verifyWebhookToken(token));
  }

  // ====================================================================
  // Recebimento (POST)
  // ====================================================================
  private validSignature(raw: Buffer | undefined, header: string | undefined, secret: string) {
    if (!raw || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
    const given = Buffer.from(header.slice(7));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async processWebhook(channel: 'FACEBOOK' | 'INSTAGRAM', body: Row, raw: Buffer | undefined, signature: string | undefined) {
    const expectedObject = channel === 'FACEBOOK' ? 'page' : 'instagram';
    if (body?.object !== expectedObject) return;
    const provider = channel === 'FACEBOOK' ? 'FACEBOOK_PAGE' : 'INSTAGRAM';
    const resolved = new Map<string, Awaited<ReturnType<SocialAccountsService['byExternalId']>>>();
    let failures = 0;

    for (const entry of body.entry ?? []) {
      const id = String(entry.id ?? '');
      if (!id) continue;
      if (!resolved.has(id)) resolved.set(id, await this.accounts.byExternalId(provider, id));
      const account = resolved.get(id);
      if (!account) { this.log.warn(`Webhook de ${channel} para conta não cadastrada: ${id}`); continue; } // conta desconhecida: responde 200 para a Meta não insistir
      if (!this.validSignature(raw, signature, account.appSecret)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 401);

      for (const m of entry.messaging ?? []) {
        try { await this.handleInbound(channel, account, String(m.sender?.id ?? ''), m); } catch (e) { failures++; this.log.error(`Falha ao processar mensagem do ${channel}: ${(e as Error).message}`); }
      }
    }
    // Erro transitório → 500 faz a Meta reenviar; a idempotência (mid único) evita duplicar.
    if (failures) throw new Error(`${failures} item(ns) do webhook falharam`);
  }

  private async handleInbound(channel: 'FACEBOOK' | 'INSTAGRAM', account: { socialAccountId: string; companyId: string }, senderId: string, m: Row) {
    const parsed = extractContent(m);
    if (!parsed || !senderId) return;
    const { companyId } = account;
    const mid = String(m.message.mid);
    if (await this.prisma.message.findUnique({ where: { companyId_externalId: { companyId, externalId: mid } }, select: { id: true } })) return; // já processada

    // Mídia: a URL que a Meta manda expira — baixamos e guardamos no nosso storage já na entrada.
    let mediaKey: string | null = null, mediaMime: string | null = null;
    if (parsed.attachmentUrl) {
      try {
        const res = await fetchAttachmentSafely(parsed.attachmentUrl);
        if (res.ok) {
          const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!;
          const buf = Buffer.from(await res.arrayBuffer());
          const ext = ATTACHMENT_EXT[mime] ?? 'bin';
          const key = `${companyId}/social/${account.socialAccountId}/${randomUUID()}.${ext}`;
          await this.storage.write(key, buf, mime);
          mediaKey = key; mediaMime = mime;
        }
      } catch (e) { this.log.warn(`Não foi possível baixar o anexo de uma mensagem do ${channel}: ${(e as Error).message}`); }
    }

    const at = m.timestamp ? new Date(Number(m.timestamp)) : new Date();
    const codeMatch = parsed.content.match(PROPERTY_CODE);

    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        let conv = await tx.conversation.findUnique({ where: { companyId_channel_externalId: { companyId, channel, externalId: senderId } } });
        const property = codeMatch ? await tx.property.findFirst({ where: { companyId, code: codeMatch[0].toUpperCase() }, select: { id: true, code: true, purpose: true, city: true, neighborhood: true, bedrooms: true, brokerId: true } }) : null;

        let customer = conv?.customerId ? await tx.customer.findFirst({ where: { id: conv.customerId, companyId } }) : null;
        customer ??= await tx.customer.create({ data: { companyId, name: channel === 'FACEBOOK' ? 'Cliente do Messenger' : 'Cliente do Instagram' } });

        // Lead: o da conversa (se ainda aberto) → um lead novo (sem telefone/e-mail não há como achar outro lead do mesmo cliente).
        let lead: Row | null = conv?.leadId ? await tx.lead.findFirst({ where: { id: conv.leadId, companyId, stage: { type: 'OPEN' } } }) : null;

        let created: Awaited<ReturnType<LeadsService['createLead']>> | null = null;
        if (!lead) {
          created = await this.leads.createLead(tx, {
            companyId, customerId: customer.id, propertyId: property?.id ?? null, source: channel, notes: preview(parsed.content, 500),
            propertyDefaults: property ? { ...property } : undefined,
          });
          lead = created.lead;
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
          leadId: lead.id, customerId: customer.id, socialAccountId: account.socialAccountId, status: 'OPEN' as const,
          lastMessageAt: at, lastInboundAt: at, lastMessagePreview: preview(parsed.content),
          ...(reopened && { handler: 'BOT' as const, botReplies: 0, handoffReason: null, handlerChangedAt: at }),
        };
        conv = conv
          ? await tx.conversation.update({ where: { id: conv.id }, data: { ...convData, unreadCount: { increment: 1 } } })
          : await tx.conversation.create({ data: { ...convData, companyId, channel, externalId: senderId, unreadCount: 1 } });

        const msg = await tx.message.create({
          data: { companyId, conversationId: conv.id, direction: 'INBOUND', externalId: mid, type: parsed.type, content: parsed.content, mediaKey, mediaMime, status: 'RECEIVED', sentAt: at, createdAt: at },
        });
        return { conversationId: conv.id, leadId: lead.id, messageId: msg.id, sessionStart, created, text: parsed.content };
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return; // outra entrega da mesma mensagem venceu a corrida
      throw e;
    }

    if (result.created) await this.leads.emitCreated(result.created);
    await this.emit(SocialInboxEvents.Received, {
      companyId, channel, leadId: result.leadId, userId: null, conversationId: result.conversationId, preview: preview(result.text), sessionStart: result.sessionStart,
    });
  }

  // ====================================================================
  // Envio (chamado pelo WhatsappService para conversas de Messenger/Instagram)
  // ====================================================================
  /** Entrega uma mensagem já gravada (QUEUED) pelo canal certo. Devolve o id da mensagem no provedor. */
  async deliver(c: Row, msg: Row): Promise<string | undefined> {
    if (!c.socialAccountId) throw new AppException('SOCIAL_INBOX_NOT_CONFIGURED', 409);
    const account = await this.prisma.socialAccount.findUnique({ where: { id: c.socialAccountId } });
    if (!account || account.status !== 'ACTIVE') throw new AppException('SOCIAL_INBOX_NOT_CONFIGURED', 409);
    const token = this.accounts.token(account.secrets);
    const graph = await this.accounts.graph(account.companyId);
    try {
      if (msg.type === 'image') {
        const r = await graph.sendMessage(token, c.externalId, { attachmentUrl: (msg.payload as { link: string }).link });
        // Legenda (se houver) como mensagem de texto em seguida: o Send API não aceita imagem + texto numa só chamada.
        if (msg.content && !/^\[(Imagem|Vídeo|Áudio|Arquivo)\]$/.test(msg.content)) await graph.sendMessage(token, c.externalId, { text: msg.content });
        return r.message_id;
      }
      return (await graph.sendMessage(token, c.externalId, { text: msg.content ?? '' })).message_id;
    } catch (e) {
      if (e instanceof SocialApiError && e.auth) await this.accounts.markExpired(account.id);
      throw e;
    }
  }
}
