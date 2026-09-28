'use client';

import type { PublicMedia } from '@imob/types';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export function Gallery({ media, title }: { media: PublicMedia[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  // No computador, clicar na foto amplia no tamanho real (rola para ver os detalhes); no celular já dá para
  // dar zoom com os dedos na foto ajustada à tela, então isso é só um extra que não atrapalha.
  const [zoomed, setZoomed] = useState(false);
  const n = media.length;
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + n) % n)), [n]);

  useEffect(() => setZoomed(false), [open]);

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
          <div className={`lb-stage ${zoomed ? 'zoomed' : ''}`} onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
            {/* Esconde as setas no zoom: com a foto em tamanho real e a página rolando, elas não têm como acompanhar. */}
            {n > 1 && !zoomed && <button className="lb-btn lb-prev" onClick={() => go(-1)} aria-label="Foto anterior"><ChevronLeft /></button>}
            <img
              src={media[open]!.url} alt={media[open]!.caption ?? `${title} — foto ${open + 1}`}
              onClick={(e) => { e.stopPropagation(); setZoomed((z) => !z); }}
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
