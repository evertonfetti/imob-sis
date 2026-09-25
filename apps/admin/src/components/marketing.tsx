import { Link } from 'react-router-dom';

export const PERIODS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '1 ano']] as const;

export function PeriodPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="period" role="tablist" aria-label="Período">
      {PERIODS.map(([n, l]) => <button key={n} role="tab" className={value === n ? 'on' : ''} onClick={() => onChange(n)}>{l}</button>)}
    </div>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

export function RateBar({ value, count }: { value: number; count?: number }) {
  return (
    <div className="ratebar" title={`${pct(value)}`}>
      <div className="track"><i style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} /></div>
      <span>{count != null ? `${count} · ` : ''}{pct(value)}</span>
    </div>
  );
}

export function MarketingTabs({ active }: { active: 'geral' | 'campanhas' | 'origens' | 'conversoes' }) {
  const tabs = [['geral', '/marketing', 'Visão geral'], ['campanhas', '/marketing/campanhas', 'Campanhas'], ['origens', '/marketing/origens', 'Origem dos leads'], ['conversoes', '/marketing/conversoes', 'Conversões']] as const;
  return (
    <div className="seg" role="tablist" style={{ marginBottom: 20 }}>
      {tabs.map(([k, to, l]) => <Link key={k} to={to} role="tab" aria-selected={active === k} className={active === k ? 'active' : ''}>{l}</Link>)}
    </div>
  );
}
