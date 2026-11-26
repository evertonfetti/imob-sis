'use client';

import { useEffect, useState } from 'react';
import { getConsent, setConsent } from '@/lib/tracking';

/**
 * Aviso de cookies de medição de campanhas.
 * - Informativo (padrão): só avisa e tem o botão "Entendi"; o Pixel carrega sempre, com ou sem clique.
 * - `ask` (PIXEL_REQUIRE_CONSENT=true): oferece Aceitar/Recusar e o Pixel só carrega com o aceite.
 */
export function ConsentBanner({ ask = false }: { ask?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(getConsent() === null); }, []);
  if (!show) return null;
  const choose = (v: 'granted' | 'denied') => { setConsent(v); setShow(false); };
  return (
    <div className="consent-banner" role="dialog" aria-label="Aviso de cookies">
      <p>
        {ask
          ? 'Usamos cookies para medir o desempenho dos nossos anúncios e melhorar a sua experiência. Você pode recusar e continuar navegando normalmente.'
          : 'Este site usa cookies e o Pixel da Meta para medir o desempenho dos nossos anúncios e melhorar a sua experiência de navegação.'}
      </p>
      <div className="consent-actions">
        {ask && <button className="btn btn-sm" onClick={() => choose('denied')}>Recusar</button>}
        <button className="btn btn-primary btn-sm" onClick={() => choose('granted')}>{ask ? 'Aceitar' : 'Entendi'}</button>
      </div>
    </div>
  );
}
