'use client';

import type { ReactNode } from 'react';
import { pixelTrack } from '@/lib/pixel';

/** Link de telefone ou e-mail: o clique vira o evento Contact no Pixel (com o canal usado). */
export function ContactLink({ href, method, children }: { href: string; method: 'phone' | 'email'; children: ReactNode }) {
  return <a href={href} onClick={() => pixelTrack('Contact', { contact_method: method })}>{children}</a>;
}
