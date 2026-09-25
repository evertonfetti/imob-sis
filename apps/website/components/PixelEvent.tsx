'use client';

import { useEffect } from 'react';
import { pixelTrack } from '@/lib/pixel';

/** Dispara um evento do Pixel quando a página abre (ex.: ViewContent na página do imóvel). */
export function PixelEvent({ name, params }: { name: string; params?: Record<string, unknown> }) {
  useEffect(() => { pixelTrack(name, params ?? {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
