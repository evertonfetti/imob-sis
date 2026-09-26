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

/** Formata enquanto digita: milhar com ponto e até 2 casas depois da vírgula ("1234567,5" → "1.234.567,5"). */
function mask(raw: string): string {
  const [int = '', ...rest] = raw.replace(/[^\d,]/g, '').split(',');
  const digits = int.replace(/^0+(?=\d)/, '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return rest.length ? `${grouped || '0'},${rest.join('').slice(0, 2)}` : grouped;
}

/** Campo monetário em R$: os pontos de milhar aparecem enquanto digita; ao sair do campo completa os centavos. */
export function MoneyInput({ value, onChange, id, placeholder = '0,00' }: {
  value: number | null | undefined; onChange: (v: number | null) => void; id?: string; placeholder?: string;
}) {
  const [text, setText] = useState(fmt(value ?? null));
  const focused = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // Só sincroniza com o valor externo quando o usuário não está digitando.
  useEffect(() => { if (!focused.current) setText(fmt(value ?? null)); }, [value]);

  function change(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    // Mantém o cursor no mesmo "caractere útil" (dígito ou vírgula) depois de reformatar.
    const useful = (t: string) => t.replace(/[^\d,]/g, '').length;
    const before = useful(el.value.slice(0, el.selectionStart ?? el.value.length));
    const next = mask(el.value);
    setText(next);
    onChange(parse(next));
    requestAnimationFrame(() => {
      const n = input.current; if (!n) return;
      let seen = 0, pos = 0;
      while (pos < next.length && seen < before) { if (/[\d,]/.test(next[pos]!)) seen++; pos++; }
      n.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="money">
      <span>R$</span>
      <input ref={input} id={id} className="input" inputMode="decimal" placeholder={placeholder} value={text}
        onChange={change}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(fmt(parse(text))); }} />
    </div>
  );
}
