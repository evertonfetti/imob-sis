import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListingPage, titleFor } from './ListingPage';
import { getCompany, getFilters, getProperties } from '@/lib/api';
import { PURPOSE_BASE, cityPath, findCity, findNeighborhood, hoodPath } from '@/lib/geo';
import { plural } from '@/lib/format';

type Kind = 'SALE' | 'RENT' | 'ALL';
type Params = { cidade: string; bairro?: string };

async function resolve(p: Params) {
  const filters = await getFilters();
  const city = findCity(filters, p.cidade);
  if (!city) notFound();
  const hood = p.bairro ? findNeighborhood(filters, p.cidade, p.bairro) : null;
  if (p.bairro && !hood) notFound();
  return { filters, city: city.name, hood: hood?.name };
}

const purposeOf = (k: Kind) => (k === 'ALL' ? undefined : k);
const verb = (k: Kind) => (k === 'SALE' ? 'à venda' : k === 'RENT' ? 'para alugar' : 'para comprar e alugar');

export async function placeMetadata(kind: Kind, params: Promise<Params>, searchParams: Promise<Record<string, unknown>>): Promise<Metadata> {
  const p = await params;
  const filtered = Object.keys(await searchParams).length > 0;
  const { city, hood } = await resolve(p);
  const where = [hood, city].filter(Boolean).join(', ');
  const total = (await getProperties({ purpose: purposeOf(kind), city, neighborhood: hood, pageSize: 1 })).total;
  const path = hood ? hoodPath(PURPOSE_BASE[kind], city, hood) : cityPath(PURPOSE_BASE[kind], city);
  return {
    title: `${titleFor(purposeOf(kind), city, hood)}${total ? ` (${total})` : ''}`,
    description: `Casas, apartamentos e terrenos ${verb(kind)} em ${where}. Veja fotos, valores e fale direto com um corretor.`,
    alternates: { canonical: path },
    robots: filtered || total === 0 ? { index: false, follow: true } : undefined, // busca filtrada e página sem imóveis não vão para o índice
  };
}

export async function PlacePage({ kind, params, searchParams }: { kind: Kind; params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await params;
  const { filters, city, hood } = await resolve(p);
  const raw = { ...(await searchParams), city, ...(hood ? { neighborhood: hood } : {}) };
  const company = await getCompany().catch(() => null);
  const name = company?.tradeName ?? company?.name ?? 'nossa equipe';
  const base = PURPOSE_BASE[kind];
  const where = [hood, city].filter(Boolean).join(', ');
  const total = filters.cities.find((c) => c.name === city)?.count ?? 0;
  const hoods = filters.neighborhoods.filter((h) => h.city === city && h.name !== hood);
  const intro = `Procurando imóveis ${verb(kind)} em ${where}? A ${name} reúne ${hood ? `opções em ${hood}` : plural(total, 'imóvel selecionado', 'imóveis selecionados') + ` em ${city}`}, com fotos, valores e atendimento direto de um corretor. Use os filtros para refinar por tipo, dormitórios, vagas e faixa de preço.`;

  return (
    <ListingPage raw={raw} base={base} fixedPurpose={kind === 'ALL' ? undefined : kind} intro={intro}>
      {(hood || hoods.length > 0) && (
        <nav aria-label="Outras regiões" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>{hood ? `Mais imóveis em ${city}` : `Bairros em ${city}`}</h2>
          <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {hood && <Link className="chip" href={cityPath(base, city)}>Todo o {city}</Link>}
            {hoods.slice(0, 30).map((h) => <Link key={h.name} className="chip" href={hoodPath(base, city, h.name)}>{h.name} ({h.count})</Link>)}
          </p>
        </nav>
      )}
    </ListingPage>
  );
}
