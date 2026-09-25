import type { Metadata } from 'next';
import { ListingPage, cleanParams, hasFilters, titleFor, type RawSP } from '@/components/ListingPage';

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSP> }): Promise<Metadata> {
  const p = cleanParams(await searchParams, 'SALE');
  return {
    title: titleFor('SALE', p.city),
    description: 'Veja casas, apartamentos e terrenos à venda.',
    alternates: { canonical: '/comprar' },
    robots: hasFilters(p) || p.page ? { index: false, follow: true } : undefined,
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSP> }) {
  return <ListingPage raw={await searchParams} base="/comprar" fixedPurpose="SALE" />;
}
