import type { PublicCompany, PublicListQuery, PublicPropertyCard, PublicPropertyDetail } from '@imob/types';
import { serverApi } from './site';

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Filters {
  types: { name: string; slug: string; count: number }[];
  cities: { name: string; count: number }[];
  neighborhoods: { name: string; city: string | null; count: number }[];
  features: { name: string; slug: string; category: string | null; count: number }[];
  price: { sale: { min: number | null; max: number | null }; rent: { min: number | null; max: number | null } };
}

export class NotFoundError extends Error {}

async function get<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${serverApi()}${path}`, { next: { revalidate } });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`API ${res.status} em ${path}`);
  return res.json() as Promise<T>;
}

export const getCompany = () => get<PublicCompany>('/public/company', 60);
export const getFilters = () => get<Filters>('/public/filters', 120);
export const getProperty = (slug: string) => get<PublicPropertyDetail>(`/public/properties/${encodeURIComponent(slug)}`, 60);
export const getSitemap = () => get<{ slug: string; updatedAt: string }[]>('/public/sitemap', 300);

export function getProperties(q: Partial<Record<keyof PublicListQuery, string | number | undefined>>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') qs.set(k, String(v));
  return get<Paged<PublicPropertyCard>>(`/public/properties?${qs}`, 60);
}
