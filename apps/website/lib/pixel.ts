'use client';

type Fbq = (cmd: string, ...args: unknown[]) => void;
type Queued = [cmd: 'track' | 'trackCustom', name: string, params: Record<string, unknown>, eventId?: string];
type W = { fbq?: Fbq; __imobPixelQueue?: Queued[] };

function send(fbq: Fbq, [cmd, name, params, eventId]: Queued) {
  if (cmd === 'track') fbq('track', name, params, eventId ? { eventID: eventId } : undefined);
  else fbq('trackCustom', name, params);
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
export function pixelTrack(name: string, params: Record<string, unknown> = {}, eventId?: string) {
  dispatch(['track', name, params, eventId]);
}

/** Evento personalizado (fora do catálogo padrão da Meta), ex.: ShareProperty. */
export function pixelTrackCustom(name: string, params: Record<string, unknown> = {}) {
  dispatch(['trackCustom', name, params]);
}
