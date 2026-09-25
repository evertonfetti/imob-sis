import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from './ui';

interface Option { id: string; label: string; sub?: string }

/** Campo de busca com lista de resultados (imóveis, leads, clientes…). */
export function SearchPicker({ value, onChange, search, placeholder, queryKey }: {
  value: Option | null; onChange: (o: Option | null) => void; search: (q: string) => Promise<Option[]>; placeholder: string; queryKey: string;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(text), 250); return () => clearTimeout(t); }, [text]);
  const q = useQuery({ queryKey: [queryKey, debounced], queryFn: () => search(debounced), enabled: open && !value });

  if (value) {
    return (
      <div className="picked">
        <span><strong style={{ fontWeight: 500 }}>{value.label}</strong>{value.sub && <span className="card-sub"> · {value.sub}</span>}</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onChange(null)} aria-label="Remover"><X size={15} /></button>
      </div>
    );
  }
  return (
    <div className="picker">
      <Input value={text} placeholder={placeholder} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (q.data?.length ? (
        <div className="picker-list">
          {q.data.map((o) => (
            <button type="button" key={o.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o); setText(''); setOpen(false); }}>
              {o.label}{o.sub && <small>{o.sub}</small>}
            </button>
          ))}
        </div>
      ) : q.isFetched ? <div className="picker-list"><div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>Nada encontrado.</div></div> : null)}
    </div>
  );
}
