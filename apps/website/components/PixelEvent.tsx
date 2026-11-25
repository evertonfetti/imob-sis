'use client';

import { useEffect } from 'react';
import { pixelTrack, pixelTrackCustom } from '@/lib/pixel';

/** Dispara um evento do Pixel quando a página abre (ex.: ViewContent na página do imóvel). `custom` = fora do catálogo padrão. */
export function PixelEvent({ name, params, custom }: { name: string; params?: Record<string, unknown>; custom?: boolean }) {
  useEffect(() => { (custom ? pixelTrackCustom : pixelTrack)(name, params ?? {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
