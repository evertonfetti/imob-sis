'use client';

import { Check, Link2, MessageCircle, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { pixelTrackCustom } from '@/lib/pixel';

/**
 * Compartilhar o imóvel: no celular abre a folha de compartilhamento do aparelho;
 * no computador, um menu com WhatsApp e "copiar link". O link é sempre o da página, sem parâmetros de campanha.
 * Cada compartilhamento vira o evento personalizado ShareProperty no Pixel (só com consentimento).
 */
export function ShareButton({ title, code, className = 'btn btn-block' }: { title: string; code: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const url = () => `${window.location.origin}${window.location.pathname}`;
  const track = (method: string) => pixelTrackCustom('ShareProperty', { content_ids: [code], content_name: title, method });

  async function main() {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title, text: `Olha esse imóvel: ${title}`, url: url() }); track('native'); } catch { /* fechou sem compartilhar */ }
      return;
    }
    setOpen((o) => !o);
  }

  function whatsapp() {
    track('whatsapp');
    window.open(`https://wa.me/?text=${encodeURIComponent(`Olha esse imóvel: ${title}\n${url()}`)}`, '_blank', 'noopener,noreferrer');
    setOpen(false);
  }

  async function copy() {
    try { await navigator.clipboard.writeText(url()); setCopied(true); track('copy'); setTimeout(() => { setCopied(false); setOpen(false); }, 1400); } catch { setOpen(false); }
  }

  return (
    <div className="share" ref={box}>
      <button type="button" className={className} onClick={main} aria-haspopup="menu" aria-expanded={open}><Share2 />Compartilhar</button>
      {open && (
        <div className="share-menu" role="menu">
          <button type="button" role="menuitem" onClick={whatsapp}><MessageCircle />Enviar por WhatsApp</button>
          <button type="button" role="menuitem" onClick={copy}>{copied ? <Check /> : <Link2 />}{copied ? 'Link copiado' : 'Copiar link'}</button>
        </div>
      )}
    </div>
  );
}
