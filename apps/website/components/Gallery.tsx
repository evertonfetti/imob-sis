'use client';

import type { PublicMedia } from '@imob/types';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const SWIPE_THRESHOLD = 50; // pixels arrastados na horizontal para valer como "trocar de foto"

export function Gallery({ media, title }: { media: PublicMedia[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  // No computador (tem mouse), clicar na foto amplia no tamanho real, para rolar e ver os detalhes.
  // No celular já dá para dar zoom com os dedos na foto ajustada à tela, então lá o clique não faz nada
  // disso — em vez disso, arrastar para o lado troca de foto (o gesto natural nesse caso).
  const [zoomed, setZoomed] = useState(false);
  const [canClickZoom, setCanClickZoom] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const n = media.length;
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + n) % n)), [n]);

  useEffect(() => setZoomed(false), [open]);
  useEffect(() => setCanClickZoom(window.matchMedia('(hover: hover) and (pointer: fine)').matches), []);

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = zoomed ? null : e.touches[0]!.clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0]!.clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD) go(dx > 0 ? -1 : 1);
  };

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, go]);

  if (!n) return <div className="g-main" style={{ cursor: 'default', display: 'grid', placeItems: 'center', color: 'var(--faint)' }}>Fotos em breve</div>;

  const strip = media.slice(1, 6);
  return (
    <>
      <div className="gallery">
        <button type="button" className="g-main" onClick={() => setOpen(0)} aria-label={`Ampliar fotos de ${title}`}>
          <img src={media[0]!.url} alt={media[0]!.caption ?? title} fetchPriority="high" />
          {media[0]!.aiModified && <span className="g-ai">Imagem editada digitalmente</span>}
          {n > 1 && <span className="g-count"><Images />{n} fotos</span>}
        </button>
        {strip.length > 0 && (
          <div className="g-strip">
            {strip.map((m, i) => (
              <button type="button" key={m.id} className="g-thumb" onClick={() => setOpen(i + 1)} aria-label={`Ver foto ${i + 2}`}>
                <img src={m.thumbnailUrl ?? m.url} alt={m.caption ?? `${title} — foto ${i + 2}`} loading="lazy" />
                {i === strip.length - 1 && n > 6 && <span className="g-more">+{n - 6}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {open !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Fotos de ${title}`}>
          <div className="lb-top"><span>{open + 1} / {n}</span><button className="lb-btn" onClick={() => setOpen(null)} aria-label="Fechar"><X /></button></div>
          <div
            className={`lb-stage ${zoomed ? 'zoomed' : ''}`}
            onClick={(e) => e.target === e.currentTarget && setOpen(null)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {/* Esconde as setas no zoom: com a foto em tamanho real e a página rolando, elas não têm como acompanhar. */}
            {n > 1 && !zoomed && <button className="lb-btn lb-prev" onClick={() => go(-1)} aria-label="Foto anterior"><ChevronLeft /></button>}
            <img
              src={media[open]!.url} alt={media[open]!.caption ?? `${title} — foto ${open + 1}`}
              className={canClickZoom ? 'can-zoom' : ''}
              onClick={(e) => { e.stopPropagation(); if (canClickZoom) setZoomed((z) => !z); }}
              aria-label={zoomed ? 'Ver ajustada à tela' : 'Ver em tamanho real'}
            />
            {n > 1 && !zoomed && <button className="lb-btn lb-next" onClick={() => go(1)} aria-label="Próxima foto"><ChevronRight /></button>}
          </div>
          <div className="lb-cap">{media[open]!.caption ?? ''}{media[open]!.aiModified && <em className="lb-ai">{media[open]!.caption ? ' · ' : ''}Imagem editada digitalmente</em>}</div>
        </div>
      )}
    </>
  );
}
