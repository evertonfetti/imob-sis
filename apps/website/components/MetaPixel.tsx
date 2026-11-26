'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isInternalTraffic } from '@/lib/internal';
import { flushPixelQueue, pixelTrack, registerPixelIds } from '@/lib/pixel';
import { ensureFbp, getConsent, getTracking } from '@/lib/tracking';

type Fbq = ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; callMethod?: (...a: unknown[]) => void; push?: unknown; version?: string };

/**
 * Pixel(s) da Meta. Carrega sempre; com `requireConsent` só depois que o visitante aceita o aviso de cookies.
 * Acessos internos (equipe, painel e subdomínios) também não carregam o Pixel.
 */
export function MetaPixel({ pixelIds, siteHost, requireConsent = false }: { pixelIds: string[]; siteHost?: string; requireConsent?: boolean }) {
  const [on, setOn] = useState(false);
  const started = useRef(false);
  const path = usePathname();

  useEffect(() => {
    (window as unknown as { __imobSiteHost?: string }).__imobSiteHost = siteHost;
    (window as unknown as { __imobRequireConsent?: boolean }).__imobRequireConsent = requireConsent;
    const internal = isInternalTraffic(siteHost);
    setOn(!internal && (!requireConsent || getConsent() === 'granted'));
    const h = (e: Event) => setOn(!internal && (!requireConsent || (e as CustomEvent).detail === 'granted'));
    window.addEventListener('imob:consent', h);
    return () => window.removeEventListener('imob:consent', h);
  }, [siteHost, requireConsent]);

  useEffect(() => {
    if (!on || started.current) return;
    started.current = true;
    const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };
    if (!w.fbq) {
      const n: Fbq = function (...a: unknown[]) { if (n.callMethod) n.callMethod(...a); else n.queue!.push(a); } as Fbq;
      w.fbq = n; w._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      const s = document.createElement('script');
      s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(s);
    }
    // O _fbp nasce antes do Pixel carregar: o espelho no servidor já sai com ele e a correspondência melhora.
    ensureFbp();
    const visitorId = getTracking().visitorId;
    for (const id of pixelIds) w.fbq!('init', id, visitorId ? { external_id: visitorId } : {});
    registerPixelIds(pixelIds);
    pixelTrack('PageView');
    flushPixelQueue();
  }, [on, pixelIds]);

  // PageView nas navegações seguintes (o site troca de página sem recarregar).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if ((window as unknown as { fbq?: Fbq }).fbq) pixelTrack('PageView');
  }, [path]);

  return null;
}
