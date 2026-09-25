'use client';

/** Origem da visita: capturada na chegada e enviada junto com o formulário / clique no WhatsApp. */
export interface Tracking {
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string;
  fbclid?: string; fbc?: string; fbp?: string; gclid?: string;
  campaignId?: string; adsetId?: string; adId?: string;
  landingPage?: string; referrer?: string;
  visitorId?: string; sessionId?: string;
}

const KEY = 'imob.tracking';
const PARAMS: Record<string, keyof Tracking> = {
  utm_source: 'utmSource', utm_medium: 'utmMedium', utm_campaign: 'utmCampaign', utm_content: 'utmContent', utm_term: 'utmTerm',
  fbclid: 'fbclid', gclid: 'gclid', campaign_id: 'campaignId', adset_id: 'adsetId', ad_id: 'adId',
};

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function cookie(name: string) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

function read(): Tracking {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

/** Chamado a cada página: mantém visitante/sessão e atualiza a origem quando chega tráfego de campanha. */
export function captureTracking() {
  try {
    const t = read();
    t.visitorId ??= uuid();
    try { t.sessionId = sessionStorage.getItem('imob.session') ?? uuid(); sessionStorage.setItem('imob.session', t.sessionId); } catch { /* ok */ }

    const url = new URL(location.href);
    let campaign = false;
    for (const [param, key] of Object.entries(PARAMS)) {
      const v = url.searchParams.get(param);
      if (v) { t[key] = v.slice(0, 300); campaign = true; }
    }
    // Primeira visita, ou chegada por campanha: registra página de entrada e referrer.
    if (!t.landingPage || campaign) {
      t.landingPage = location.href.slice(0, 500);
      t.referrer = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer.slice(0, 500) : t.referrer;
    }
    // Meta: se veio de anúncio (fbclid) e o Pixel ainda não criou _fbc, montamos no formato oficial.
    if (t.fbclid && !cookie('_fbc')) {
      t.fbc = `fb.1.${Date.now()}.${t.fbclid}`;
      document.cookie = `_fbc=${encodeURIComponent(t.fbc)}; max-age=${90 * 86400}; path=/; SameSite=Lax`;
    }
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch { /* navegação privada ou storage bloqueado: o site segue funcionando */ }
}

export type Consent = 'granted' | 'denied' | null;
const CONSENT_KEY = 'imob.consent';

export function getConsent(): Consent {
  try { const v = localStorage.getItem(CONSENT_KEY); return v === 'granted' || v === 'denied' ? v : null; } catch { return null; }
}

export function setConsent(v: 'granted' | 'denied') {
  try { localStorage.setItem(CONSENT_KEY, v); } catch { /* sem storage: vale só nesta página */ }
  window.dispatchEvent(new CustomEvent('imob:consent', { detail: v }));
}

/** ID único do evento: o mesmo valor vai ao Pixel (navegador) e ao servidor (CAPI) para a Meta contar uma vez só. */
export const newEventId = () => uuid();

/** Campos de marketing que acompanham o formulário e o clique no WhatsApp. */
export function marketingFields(eventId: string) {
  return { eventId, pageUrl: location.href.slice(0, 500), marketingConsent: getConsent() === 'granted' };
}

export function getTracking(): Tracking {
  try {
    const t = read();
    return { ...t, fbc: cookie('_fbc') ?? t.fbc, fbp: cookie('_fbp') ?? t.fbp };
  } catch { return {}; }
}
