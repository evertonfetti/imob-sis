import type { MetadataRoute } from 'next';
import { getFilters, getProperties, getSitemap } from '@/lib/api';
import { PURPOSE_BASE, cityPath, hoodPath } from '@/lib/geo';
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
  // Páginas de cidade e bairro: só entram se houver imóvel para a finalidade (evita páginas vazias no índice).
  const places: MetadataRoute.Sitemap = [];
  try {
    const f = await getFilters();
    const paths = [
      ...f.cities.map((c) => ({ city: c.name, hood: undefined as string | undefined })),
      ...f.neighborhoods.filter((h) => h.city).map((h) => ({ city: h.city!, hood: h.name })),
    ].slice(0, 300);
    await Promise.all(paths.flatMap((x) => (['SALE', 'RENT', 'ALL'] as const).map(async (k) => {
      const r = await getProperties({ purpose: k === 'ALL' ? undefined : k, city: x.city, neighborhood: x.hood, pageSize: 1 });
      if (r.total > 0) places.push({ url: `${base}${x.hood ? hoodPath(PURPOSE_BASE[k], x.city, x.hood) : cityPath(PURPOSE_BASE[k], x.city)}`, changeFrequency: 'daily', priority: x.hood ? 0.6 : 0.7 });
    })));
  } catch { /* sem as páginas de região */ }
  return [...fixed, ...places, ...props];
}
