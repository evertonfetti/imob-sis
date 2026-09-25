'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getConsent } from '@/lib/tracking';

type Fbq = ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; callMethod?: (...a: unknown[]) => void; push?: unknown; version?: string };

/**
 * Pixel da Meta. Só é carregado depois que o visitante aceita o aviso de cookies (LGPD).
 * Se ele recusar, nenhum script da Meta é baixado.
 */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  const [on, setOn] = useState(false);
  const started = useRef(false);
  const path = usePathname();

  useEffect(() => {
    setOn(getConsent() === 'granted');
    const h = (e: Event) => setOn((e as CustomEvent).detail === 'granted');
    window.addEventListener('imob:consent', h);
    return () => window.removeEventListener('imob:consent', h);
  }, []);

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
    w.fbq!('init', pixelId);
    w.fbq!('track', 'PageView');
  }, [on, pixelId]);

  // PageView nas navegações seguintes (o site troca de página sem recarregar).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    (window as unknown as { fbq?: Fbq }).fbq?.('track', 'PageView');
  }, [path]);

  return null;
}
