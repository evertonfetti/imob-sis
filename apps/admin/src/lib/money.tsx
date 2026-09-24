import { useEffect, useRef, useState } from 'react';

export const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const fmt = (v: number | null) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function parse(text: string): number | null {
  const clean = text.replace(/[^\d,]/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** Campo monetário em R$: digita livremente, formata ao sair do campo. */
export function MoneyInput({ value, onChange, id, placeholder = '0,00' }: {
  value: number | null | undefined; onChange: (v: number | null) => void; id?: string; placeholder?: string;
}) {
  const [text, setText] = useState(fmt(value ?? null));
  const focused = useRef(false);
  // Só sincroniza com o valor externo quando o usuário não está digitando.
  useEffect(() => { if (!focused.current) setText(fmt(value ?? null)); }, [value]);
  return (
    <div className="money">
      <span>R$</span>
      <input id={id} className="input" inputMode="decimal" placeholder={placeholder} value={text}
        onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(fmt(parse(text))); }} />
    </div>
  );
}
