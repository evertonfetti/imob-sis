'use client';

type Fbq = (cmd: string, ...args: unknown[]) => void;

/** Dispara um evento do Pixel da Meta. Sem Pixel carregado (sem consentimento) não faz nada. */
export function pixelTrack(name: string, params: Record<string, unknown> = {}, eventId?: string) {
  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (fbq) fbq('track', name, params, eventId ? { eventID: eventId } : undefined);
  } catch { /* nunca atrapalha o visitante */ }
}
