import type { ReactNode } from 'react';

/** Barras horizontais com rótulo e valor: leads por origem, imóveis mais procurados, motivos de perda. */
export function BarList({ rows, empty = 'Sem dados no período.' }: { rows: { key: string; label: ReactNode; value: number; note?: ReactNode }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="card-sub" style={{ padding: '18px 0' }}>{empty}</div>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.key} className="bar-row">
          <div className="bar-top"><span className="bar-label">{r.label}</span><strong>{r.value}</strong></div>
          <div className="bar-track"><i style={{ width: `${(r.value / max) * 100}%` }} /></div>
          {r.note && <div className="bar-note">{r.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** Funil: cada etapa como barra proporcional à primeira, com % de passagem em relação à etapa anterior. */
export function Funnel({ steps }: { steps: { key: string; name: string; color: string; reached: number }[] }) {
  const top = Math.max(1, steps[0]?.reached ?? 0, ...steps.map((s) => s.reached));
  if (!steps.length || !steps.some((s) => s.reached)) return <div className="card-sub" style={{ padding: '18px 0' }}>Sem leads no período.</div>;
  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1]!.reached : 0;
        return (
          <div key={s.key} className="funnel-row">
            <span className="funnel-name">{s.name}</span>
            <div className="funnel-track"><i style={{ width: `${Math.max(2, (s.reached / top) * 100)}%`, background: s.color }} /></div>
            <span className="funnel-val"><strong>{s.reached}</strong>{i > 0 && prev > 0 && <small>{Math.round((s.reached / prev) * 100)}%</small>}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Linha com área suave e eixo mínimo (datas nas pontas). */
export function LineChart({ points, height = 150 }: { points: { date: string; value: number }[]; height?: number }) {
  if (!points.length) return null;
  const W = 600, H = height, pad = { l: 26, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const total = points.reduce((n, p) => n + p.value, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="linechart" role="img" aria-label={`Leads por dia: ${total} no período`} preserveAspectRatio="none">
      {[0, 0.5, 1].map((t) => <line key={t} x1={pad.l} x2={W - pad.r} y1={y(nice * t)} y2={y(nice * t)} className="grid" />)}
      {[0, 1].map((t) => <text key={t} x={pad.l - 6} y={y(nice * t) + 4} textAnchor="end" className="axis">{Math.round(nice * t)}</text>)}
      <path d={area} className="area" />
      <path d={line} className="line" />
      {points.length <= 45 && points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.value)} r={2.4} className="dot"><title>{`${fmt(p.date)}: ${p.value}`}</title></circle>)}
      <text x={pad.l} y={H - 5} className="axis">{fmt(points[0]!.date)}</text>
      <text x={W - pad.r} y={H - 5} textAnchor="end" className="axis">{fmt(points.at(-1)!.date)}</text>
    </svg>
  );
}
