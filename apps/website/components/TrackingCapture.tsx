'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { captureTracking } from '@/lib/tracking';

/** Registra a origem da visita (UTMs, fbclid, gclid…) para enviar junto com o lead. */
export function TrackingCapture() {
  const path = usePathname();
  useEffect(() => { captureTracking(); }, [path]);
  return null;
}
