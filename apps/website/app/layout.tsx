import type { Metadata } from 'next';
import '@fontsource-variable/geist';
import '@fontsource-variable/newsreader';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Imobiliária', template: '%s · Imobiliária' },
  description: 'Encontre o imóvel ideal para comprar ou alugar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
