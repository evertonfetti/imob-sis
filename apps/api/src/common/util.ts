/** Converte strings vazias em null (formulários enviam "" para campos limpos). */
export const blankToNull = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as { [K in keyof T]: T[K] extends string ? T[K] | null : T[K] };

/** Telefone só com dígitos e sem o código do país (55). */
export function normalizePhone(v: string) {
  let d = v.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}

/** "500.000", "R$ 1.500,50", 350000 → número (formato brasileiro: ponto separa milhar, vírgula os centavos). */
export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 1e10 ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1e10 ? n : null;
}
