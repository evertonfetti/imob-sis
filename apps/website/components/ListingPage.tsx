import { X } from 'lucide-react';
import Link from 'next/link';
import { FilterPanel } from './FilterPanel';
import { Pagination } from './Pagination';
import { PropertyCard } from './PropertyCard';
import { brl, plural } from '@/lib/format';
import { getFilters, getProperties, type Filters } from '@/lib/api';

export type RawSP = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 12;
const NUMERIC = ['priceMin', 'priceMax', 'bedrooms', 'suites', 'parkingSpaces', 'areaMin', 'areaMax'];
const TEXT = ['type', 'city', 'neighborhood', 'q'];

/** Só repassa à API valores válidos: entrada malformada na URL nunca vira erro 500. */
export function cleanParams(raw: RawSP, fixedPurpose?: 'SALE' | 'RENT') {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
  const out: Record<string, string> = {};
  const purpose = fixedPurpose ?? one(raw.purpose);
  if (purpose === 'SALE' || purpose === 'RENT') out.purpose = purpose;
  for (const k of NUMERIC) { const v = one(raw[k]); if (v && /^\d+(\.\d+)?$/.test(v)) out[k] = v; }
  for (const k of TEXT) { const v = one(raw[k]); if (v) out[k] = v.slice(0, 100); }
  const feats = [raw.feat, raw.features].flat().filter(Boolean).join(',').split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9-]+$/.test(s));
  if (feats.length) out.features = [...new Set(feats)].slice(0, 12).join(',');
  const sort = one(raw.sort);
  if (sort === 'price_asc' || sort === 'price_desc') out.sort = sort;
  const page = Number(one(raw.page));
  if (Number.isInteger(page) && page > 1 && page <= 500) out.page = String(page);
  return out;
}

export const hasFilters = (p: Record<string, string>) => Object.keys(p).some((k) => k !== 'page' && k !== 'purpose' && k !== 'sort') || !!p.sort;

export function titleFor(purpose: string | undefined, city?: string) {
  const base = purpose === 'SALE' ? 'Imóveis à venda' : purpose === 'RENT' ? 'Imóveis para alugar' : 'Todos os imóveis';
  return city ? `${base} em ${city}` : base;
}

function chips(p: Record<string, string>, f: Filters, fixed: boolean) {
  const out: { key: string; label: string; drop: string[] }[] = [];
  if (p.purpose && !fixed) out.push({ key: 'purpose', label: p.purpose === 'SALE' ? 'Comprar' : 'Alugar', drop: ['purpose'] });
  if (p.type) out.push({ key: 'type', label: f.types.find((t) => t.slug === p.type)?.name ?? p.type, drop: ['type'] });
  if (p.city) out.push({ key: 'city', label: p.city, drop: ['city', 'neighborhood'] });
  if (p.neighborhood) out.push({ key: 'nb', label: p.neighborhood, drop: ['neighborhood'] });
  if (p.q) out.push({ key: 'q', label: `“${p.q}”`, drop: ['q'] });
  if (p.priceMin || p.priceMax) out.push({ key: 'price', label: [p.priceMin && `de ${brl(Number(p.priceMin))}`, p.priceMax && `até ${brl(Number(p.priceMax))}`].filter(Boolean).join(' '), drop: ['priceMin', 'priceMax'] });
  if (p.bedrooms) out.push({ key: 'bed', label: `${p.bedrooms}+ dormitórios`, drop: ['bedrooms'] });
  if (p.suites) out.push({ key: 'su', label: `${p.suites}+ suítes`, drop: ['suites'] });
  if (p.parkingSpaces) out.push({ key: 'pk', label: `${p.parkingSpaces}+ vagas`, drop: ['parkingSpaces'] });
  if (p.areaMin || p.areaMax) out.push({ key: 'area', label: [p.areaMin && `de ${p.areaMin} m²`, p.areaMax && `até ${p.areaMax} m²`].filter(Boolean).join(' '), drop: ['areaMin', 'areaMax'] });
  for (const slug of (p.features ?? '').split(',').filter(Boolean)) {
    out.push({ key: `f-${slug}`, label: f.features.find((x) => x.slug === slug)?.name ?? slug, drop: [`f:${slug}`] });
  }
  return out;
}

export async function ListingPage({ raw, base, fixedPurpose }: { raw: RawSP; base: string; fixedPurpose?: 'SALE' | 'RENT' }) {
  const params = cleanParams(raw, fixedPurpose);
  const [data, filters] = await Promise.all([
    getProperties({ ...params, pageSize: PAGE_SIZE }),
    getFilters(),
  ]);
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const page = data.page;

  const url = (over: Record<string, string | undefined>, drop: string[] = []) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | undefined> = { ...params, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (!v || (fixedPurpose && k === 'purpose') || drop.includes(k)) continue;
      if (k === 'features') {
        const keep = v.split(',').filter((s) => !drop.includes(`f:${s}`));
        if (keep.length) q.set('features', keep.join(','));
        continue;
      }
      q.set(k, v);
    }
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const active = chips(params, filters, !!fixedPurpose);
  const sp = { ...params, feat: params.features } as Record<string, string | undefined>;

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{titleFor(fixedPurpose ?? params.purpose, params.city)}</h1>
        <p>{data.total === 0 ? 'Nenhum imóvel encontrado com esses filtros.' : `${plural(data.total, 'imóvel encontrado', 'imóveis encontrados')}${pages > 1 ? ` · página ${page} de ${pages}` : ''}`}</p>
      </div>

      <div className="listing">
        <aside>
          <input type="checkbox" id="ft" className="sr ft-check" />
          <label htmlFor="ft" className="btn filters-toggle">Filtros{active.length ? ` (${active.length})` : ''}</label>
          <div className="filters-body">
            <FilterPanel filters={filters} sp={sp} fixedPurpose={fixedPurpose} action={base} />
          </div>
        </aside>

        <section aria-label="Resultados">
          {active.length > 0 && (
            <div className="active">
              {active.map((c) => (
                <Link key={c.key} href={url({ page: undefined }, c.drop)} className="chip" aria-label={`Remover filtro ${c.label}`}>{c.label}<X /></Link>
              ))}
              <Link href={base} className="chip" style={{ background: 'none', color: 'var(--muted)' }}>Limpar tudo</Link>
            </div>
          )}
          {data.items.length === 0 ? (
            <div className="empty">
              <h2>Nada por aqui… ainda.</h2>
              <p>Tente ampliar a busca ou remover alguns filtros. Se preferir, fale com a gente: podemos encontrar o imóvel ideal para você.</p>
              <p style={{ marginTop: 20 }}><Link className="btn btn-primary" href={base}>Ver todos os imóveis</Link></p>
            </div>
          ) : (
            <div className="grid">
              {data.items.map((p, i) => <PropertyCard key={p.id} p={p} prefer={fixedPurpose ?? (params.purpose as 'SALE' | 'RENT' | undefined)} priority={i < 3} />)}
            </div>
          )}
          <Pagination page={page} pages={pages} href={(n) => url({ page: n > 1 ? String(n) : undefined })} />
        </section>
      </div>
    </div>
  );
}
