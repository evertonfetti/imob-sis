import type { PublicPropertyCard } from '@imob/types';

export const brl = (v: number | null | undefined) =>
  v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const area = (v: number | null | undefined) => (v == null ? '' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`);

export const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** Número para wa.me: garante o código do país. */
export function waNumber(v: string | null | undefined) {
  const d = digits(v);
  if (!d) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

export function priceOf(p: Pick<PublicPropertyCard, 'purpose' | 'salePrice' | 'rentPrice'>, prefer?: 'SALE' | 'RENT') {
  const rent = prefer === 'RENT' || p.purpose === 'RENT' || (!p.salePrice && !!p.rentPrice);
  return rent ? { value: p.rentPrice, suffix: '/mês', kind: 'RENT' as const } : { value: p.salePrice, suffix: '', kind: 'SALE' as const };
}

export const purposeLabel = (p: string) => (p === 'RENT' ? 'Aluguel' : p === 'SALE' ? 'Venda' : 'Venda e aluguel');

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function truncate(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}
