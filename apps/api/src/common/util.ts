/** Converte strings vazias em null (formulários enviam "" para campos limpos). */
export const blankToNull = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as { [K in keyof T]: T[K] extends string ? T[K] | null : T[K] };
