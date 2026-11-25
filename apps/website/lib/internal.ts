'use client';

/**
 * Tráfego interno: equipe da imobiliária navegando no site, ou o site aberto por um endereço que não é o público
 * (ex.: painel em admin.seudominio.com.br, api.*, staging). Esse acesso nunca vai para o Pixel nem para a
 * Conversions API, para não sujar as métricas das campanhas.
 *
 * Como o painel e o site compartilham o domínio principal, o painel grava o cookie `imob_staff` no domínio
 * pai quando alguém entra; o site lê esse cookie. Também dá para marcar/desmarcar um aparelho à mão:
 * abra o site com `?imob_internal=1` (ou `=0`).
 */
const COOKIE = 'imob_staff';
const LS_KEY = 'imob.internal';

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** Só o endereço público do site (com ou sem "www") conta como visita de cliente. */
export function isPublicHost(siteHost: string | undefined, host = location.hostname) {
  if (!siteHost) return true;
  return stripWww(host) === stripWww(siteHost);
}

export function isInternalTraffic(siteHost?: string): boolean {
  try {
    const q = new URLSearchParams(location.search).get('imob_internal');
    if (q === '1') localStorage.setItem(LS_KEY, '1');
    else if (q === '0') { localStorage.removeItem(LS_KEY); document.cookie = `${COOKIE}=; max-age=0; path=/`; }
    if (localStorage.getItem(LS_KEY) === '1') return true;
  } catch { /* storage bloqueado */ }
  try {
    if (new RegExp(`(?:^|; )${COOKIE}=1`).test(document.cookie)) return true;
    return !isPublicHost(siteHost);
  } catch { return false; }
}
