/** URL pública do site (canonical, sitemap, Open Graph). Lida em tempo de execução. */
export const siteUrl = () => (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Base da API usada no servidor do site (rede interna no Docker) e no navegador (URL pública). */
export const serverApi = () =>
  (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api/v1').replace(/\/$/, '');
export const browserApi = () => (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api/v1').replace(/\/$/, '');
