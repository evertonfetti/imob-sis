'use client';

import { MessageCircle } from 'lucide-react';
import { waNumber } from '@/lib/format';
import { browserApi } from '@/lib/site';
import { getTracking } from '@/lib/tracking';

/**
 * Link do WhatsApp. Antes de abrir a conversa registra o clique (com a origem da visita),
 * sem bloquear a navegação: o link funciona mesmo se o registro falhar.
 */
export function WhatsAppButton({ whatsapp, message, propertyId, className = 'btn btn-wa', label = 'Chamar no WhatsApp', textClass }: {
  whatsapp: string | null; message?: string; propertyId?: string; className?: string; label?: string; textClass?: string;
}) {
  const number = waNumber(whatsapp);
  if (!number) return null;
  const href = `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

  function track() {
    const t = getTracking();
    try {
      void fetch(`${browserApi()}/public/whatsapp-click`, {
        method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyId: propertyId ?? null, ...t }),
      }).catch(() => undefined);
    } catch { /* ignora */ }
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={track}>
      <MessageCircle /><span className={textClass}>{label}</span>
    </a>
  );
}
