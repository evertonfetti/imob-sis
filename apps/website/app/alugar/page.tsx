import type { Metadata } from 'next';
import { ListingPage, cleanParams, hasFilters, titleFor, type RawSP } from '@/components/ListingPage';

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSP> }): Promise<Metadata> {
  const p = cleanParams(await searchParams, 'RENT');
  return {
    title: titleFor('RENT', p.city),
    description: 'Veja casas, apartamentos e imóveis comerciais para alugar.',
    alternates: { canonical: '/alugar' },
    robots: hasFilters(p) || p.page ? { index: false, follow: true } : undefined,
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSP> }) {
  return <ListingPage raw={await searchParams} base="/alugar" fixedPurpose="RENT" />;
}
