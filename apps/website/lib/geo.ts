import type { Filters } from './api';

export type Purpose = 'SALE' | 'RENT' | undefined;

/** "São José do Rio Preto" → "sao-jose-do-rio-preto". */
export const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const PURPOSE_BASE: Record<'SALE' | 'RENT' | 'ALL', string> = { SALE: '/comprar', RENT: '/alugar', ALL: '/imoveis' };

export function findCity(f: Filters, citySlug: string) {
  return f.cities.find((c) => slugify(c.name) === citySlug) ?? null;
}

export function findNeighborhood(f: Filters, citySlug: string, hoodSlug: string) {
  return f.neighborhoods.find((h) => h.city && slugify(h.city) === citySlug && slugify(h.name) === hoodSlug) ?? null;
}

export const cityPath = (base: string, city: string) => `${base}/${slugify(city)}`;
export const hoodPath = (base: string, city: string, hood: string) => `${base}/${slugify(city)}/${slugify(hood)}`;
