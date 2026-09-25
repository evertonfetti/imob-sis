import type { Metadata } from 'next';
import { ListingPage, cleanParams, hasFilters, titleFor, type RawSP } from '@/components/ListingPage';

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSP> }): Promise<Metadata> {
  const p = cleanParams(await searchParams);
  return {
    title: titleFor(p.purpose, p.city),
    description: 'Veja casas, apartamentos, terrenos e imóveis comerciais para comprar ou alugar.',
    alternates: { canonical: '/imoveis' },
    robots: hasFilters(p) || p.page ? { index: false, follow: true } : undefined, // buscas filtradas não entram no índice
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSP> }) {
  return <ListingPage raw={await searchParams} base="/imoveis" />;
}
