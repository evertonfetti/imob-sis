import type { Metadata } from 'next';
import '@fontsource-variable/geist';
import '@fontsource-variable/newsreader';
import './globals.css';
import type { PublicCompany } from '@imob/types';
import { Footer } from '@/components/Footer';
import { ConsentBanner } from '@/components/ConsentBanner';
import { Header } from '@/components/Header';
import { MetaPixel } from '@/components/MetaPixel';
import { PhotoGuard } from '@/components/PhotoGuard';
import { TrackingCapture } from '@/components/TrackingCapture';
import { getCompany } from '@/lib/api';
import { siteUrl } from '@/lib/site';

// O site lê dados da API a cada requisição (com cache de dados): nada é gerado no build.
export const dynamic = 'force-dynamic';

const FALLBACK: PublicCompany = { name: 'Imobiliária', tradeName: null, creci: null, email: null, phone: null, whatsapp: null, website: null, logoUrl: null, primaryColor: null, address: null, metaPixelId: null, metaPixelIds: [] };

async function company(): Promise<PublicCompany> {
  try { return await getCompany(); } catch { return FALLBACK; }
}

export async function generateMetadata(): Promise<Metadata> {
  const c = await company();
  const name = c.tradeName ?? c.name;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${name} · Imóveis para comprar e alugar`, template: `%s · ${name}` },
    description: `Encontre casas, apartamentos e terrenos para comprar ou alugar com a ${name}.`,
    openGraph: { siteName: name, locale: 'pt_BR', type: 'website' },
    alternates: { canonical: '/' },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await company();
  const accent = c.primaryColor && /^#[0-9a-fA-F]{6}$/.test(c.primaryColor) ? c.primaryColor : undefined;
  // Pixels ativos cadastrados em Integrações; sem nenhum, usa META_PIXEL_ID (um ou mais IDs separados por vírgula).
  const envIds = (process.env.META_PIXEL_ID ?? '').split(',').map((v) => v.trim()).filter((v) => /^\d{8,20}$/.test(v));
  const pixelIds = c.metaPixelIds?.length ? c.metaPixelIds : envIds;
  // Padrão: o Pixel carrega sempre. PIXEL_REQUIRE_CONSENT=true volta a exigir o aceite do aviso de cookies.
  const requireConsent = process.env.PIXEL_REQUIRE_CONSENT === 'true';
  const siteHost = new URL(siteUrl()).hostname;
  const org = {
    '@context': 'https://schema.org', '@type': 'RealEstateAgent', name: c.tradeName ?? c.name, url: siteUrl(),
    ...(c.phone && { telephone: c.phone }), ...(c.email && { email: c.email }), ...(c.logoUrl && { logo: c.logoUrl }),
  };
  return (
    <html lang="pt-BR" style={accent ? ({ '--accent': accent } as React.CSSProperties) : undefined}>
      <body>
        <Header company={c} />
        <main>{children}</main>
        <Footer company={c} />
        <TrackingCapture />
        <PhotoGuard />
        {pixelIds.length > 0 && <><MetaPixel pixelIds={pixelIds} siteHost={siteHost} requireConsent={requireConsent} />{requireConsent && <ConsentBanner />}</>}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
      </body>
    </html>
  );
}
