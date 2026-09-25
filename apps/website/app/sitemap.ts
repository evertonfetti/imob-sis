import type { MetadataRoute } from 'next';
import { getSitemap } from '@/lib/api';
import { siteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const fixed: MetadataRoute.Sitemap = ['', '/comprar', '/alugar', '/imoveis'].map((p) => ({
    url: `${base}${p}`, changeFrequency: 'daily', priority: p === '' ? 1 : 0.8,
  }));
  let props: MetadataRoute.Sitemap = [];
  try {
    props = (await getSitemap()).map((s) => ({ url: `${base}/imovel/${s.slug}`, lastModified: new Date(s.updatedAt), changeFrequency: 'weekly', priority: 0.7 }));
  } catch { /* API fora do ar: entrega ao menos as páginas fixas */ }
  return [...fixed, ...props];
}
