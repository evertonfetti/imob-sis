'use client';

import { browserApi } from './site';
import { getTracking, newEventId } from './tracking';

type Fbq = (cmd: string, ...args: unknown[]) => void;
type Opts = { eventId?: string; mirror?: boolean };
type Queued = [cmd: 'track' | 'trackCustom', name: string, params: Record<string, unknown>, opts: Opts];
type W = { fbq?: Fbq; __imobPixelQueue?: Queued[]; __imobPixelIds?: string[] };

/** Eventos que também vão ao servidor (Conversions API) com o mesmo event_id. Lead e WhatsApp têm fluxo próprio. */
const MIRRORED = new Set(['PageView', 'ViewContent', 'Search', 'ViewCategory', 'PropertyCardClick', 'ShareProperty', 'Contact']);

/**
 * Dispara no Pixel e espelha no servidor com o MESMO event_id: a Meta junta os dois e conta uma vez
 * (deduplicação), mas ganha IP, navegador e identificadores que o navegador sozinho nem sempre entrega.
 * Só chega aqui quando o Pixel está ativo, ou seja, com cookies aceitos e fora do tráfego interno.
 */
function send(fbq: Fbq, [cmd, name, params, opts]: Queued) {
  const eventId = opts.eventId ?? newEventId();
  fbq(cmd, name, params, { eventID: eventId });
  if (opts.mirror === false || !MIRRORED.has(name)) return;
  try {
    const t = getTracking();
    void fetch(`${browserApi()}/public/pixel-events`, {
      method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, eventId, params, pageUrl: location.href.slice(0, 500), fbc: t.fbc, fbp: t.fbp, visitorId: t.visitorId }),
    }).catch(() => undefined);
  } catch { /* ignora */ }
}

/**
 * Se o Pixel ainda não carregou (a página acabou de abrir ou o aviso de cookies ainda não foi respondido),
 * o evento espera numa fila e só é enviado quando o Pixel iniciar. Se o visitante recusar, ou for tráfego
 * interno, o Pixel nunca inicia e a fila nunca é enviada.
 */
function dispatch(item: Queued) {
  try {
    const w = window as unknown as W;
    if (w.fbq) return send(w.fbq, item);
    const q = (w.__imobPixelQueue ??= []);
    if (q.length < 30) q.push(item);
  } catch { /* nunca atrapalha o visitante */ }
}

/** Chamado pelo MetaPixel logo depois do PageView: envia o que ficou esperando. */
export function flushPixelQueue() {
  try {
    const w = window as unknown as W;
    const q = w.__imobPixelQueue;
    w.__imobPixelQueue = [];
    if (w.fbq && q) for (const item of q) send(w.fbq, item);
  } catch { /* ok */ }
}

/** Evento padrão da Meta (ViewContent, Lead, Contact, Search…). */
export function pixelTrack(name: string, params: Record<string, unknown> = {}, eventId?: string, opts: { mirror?: boolean } = {}) {
  dispatch(['track', name, params, { eventId, mirror: opts.mirror }]);
}

/** Evento personalizado (fora do catálogo padrão da Meta), ex.: ShareProperty. */
export function pixelTrackCustom(name: string, params: Record<string, unknown> = {}) {
  dispatch(['trackCustom', name, params, {}]);
}

/** IDs dos Pixels iniciados nesta página (para atualizar os dados do visitante em todos). */
export function registerPixelIds(ids: string[]) {
  (window as unknown as W).__imobPixelIds = ids;
}

/**
 * Correspondência avançada: informa e-mail, telefone e nome do visitante ao Pixel (a Meta faz o hash no
 * navegador) logo antes de um evento de conversão, como o Lead. Sem Pixel ativo não faz nada.
 */
export function pixelSetUser(u: { email?: string | null; phone?: string | null; name?: string | null }) {
  try {
    const w = window as unknown as W;
    if (!w.fbq || !w.__imobPixelIds?.length) return;
    const digits = (u.phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
    const parts = (u.name ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const data: Record<string, string> = {
      ...(u.email && { em: u.email.trim().toLowerCase() }),
      ...(digits && { ph: digits.startsWith('55') && digits.length > 11 ? digits : `55${digits}` }),
      ...(parts[0] && { fn: parts[0] }),
      ...(parts.length > 1 && { ln: parts[parts.length - 1]! }),
      country: 'br',
    };
    const visitorId = getTracking().visitorId;
    if (visitorId) data.external_id = visitorId;
    for (const id of w.__imobPixelIds) w.fbq('init', id, data);
  } catch { /* ok */ }
}
