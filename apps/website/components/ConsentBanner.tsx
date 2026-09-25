'use client';

import { useEffect, useState } from 'react';
import { getConsent, setConsent } from '@/lib/tracking';

/** Aviso de cookies de medição de campanhas (LGPD). Aparece só se a imobiliária usa o Pixel da Meta. */
export function ConsentBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(getConsent() === null); }, []);
  if (!show) return null;
  const choose = (v: 'granted' | 'denied') => { setConsent(v); setShow(false); };
  return (
    <div className="consent-banner" role="dialog" aria-label="Aviso de cookies">
      <p>Usamos cookies para medir o desempenho dos nossos anúncios e melhorar a sua experiência. Você pode recusar e continuar navegando normalmente.</p>
      <div className="consent-actions">
        <button className="btn btn-sm" onClick={() => choose('denied')}>Recusar</button>
        <button className="btn btn-primary btn-sm" onClick={() => choose('granted')}>Aceitar</button>
      </div>
    </div>
  );
}
