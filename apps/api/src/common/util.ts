/** Converte strings vazias em null (formulários enviam "" para campos limpos). */
export const blankToNull = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as { [K in keyof T]: T[K] extends string ? T[K] | null : T[K] };

/** Telefone só com dígitos e sem o código do país (55). */
export function normalizePhone(v: string) {
  let d = v.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d;
}
