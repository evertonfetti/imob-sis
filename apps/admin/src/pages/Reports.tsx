import { LEAD_SOURCE_LABELS, type ReportOverviewDto } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, Funnel, LineChart } from '../components/charts';
import { ScoreBadge } from '../components/intelligence';
import { Input, PageHeader, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { brl } from '../lib/money';

const PRESETS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']] as const;
export const pctText = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

/** Início do dia local (n dias atrás) e agora, em ISO. */
export function rangeOf(days: number) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString(), to: new Date().toISOString() };
}
export const useOverview = (r: { from: string; to: string }) => useQuery({ queryKey: ['report', r.from.slice(0, 10), r.to.slice(0, 10)], queryFn: () => api<ReportOverviewDto>(`/reports/overview?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`), placeholderData: (p) => p });

export const sourceRows = (d: ReportOverviewDto) => d.bySource.map((s) => ({ key: s.source, label: LEAD_SOURCE_LABELS[s.source as keyof typeof LEAD_SOURCE_LABELS] ?? s.source, value: s.leads, note: s.won ? `${s.won} ${s.won === 1 ? 'negócio fechado' : 'negócios fechados'}` : undefined }));
export const propertyRows = (d: ReportOverviewDto) => d.topProperties.map((p) => ({ key: p.propertyId, label: <Link to={`/imoveis/${p.propertyId}`} style={{ color: 'inherit' }}>{p.code} · {p.title}</Link>, value: p.leads, note: `${p.visits} ${p.visits === 1 ? 'visita' : 'visitas'} · ${p.proposals} ${p.proposals === 1 ? 'proposta' : 'propostas'}` }));

export function Reports() {
  const [days, setDays] = useState<number | 'custom'>(30);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const range = days === 'custom' && custom.from && custom.to ? { from: new Date(`${custom.from}T00:00:00`).toISOString(), to: new Date(`${custom.to}T23:59:59`).toISOString() } : rangeOf(days === 'custom' ? 30 : days);
  const q = useOverview(range);
  const d = q.data;

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Como estão os leads, o funil e os negócios no período."
        actions={<div className="range-pills">{PRESETS.map(([n, label]) => <button key={n} className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>{label}</button>)}
          <button className={`chip ${days === 'custom' ? 'on' : ''}`} onClick={() => setDays('custom')}>Personalizado</button></div>} />
      {days === 'custom' && (
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="De" style={{ width: 170 }} />
          <span className="card-sub">até</span>
          <Input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Até" style={{ width: 170 }} />
          {!(custom.from && custom.to) && <span className="card-sub">Escolha as duas datas.</span>}
        </div>
      )}
      {!d ? <div className="card"><SkeletonRows rows={8} /></div> : (
        <>
          <div className="kpis">
            <Kpi label="Novos leads" value={d.kpis.newLeads} foot={`${d.kpis.openLeads} em aberto agora`} />
            <Kpi label="Conversão" value={pctText(d.kpis.conversionRate)} foot={`${d.kpis.wonLeads} ${d.kpis.wonLeads === 1 ? 'lead virou negócio' : 'leads viraram negócio'}`} />
            <Kpi label="Tempo até fechar" value={d.kpis.avgDaysToClose == null ? '—' : `${String(d.kpis.avgDaysToClose).replace('.', ',')} d`} foot="média dos negócios fechados" />
            <Kpi label="Volume negociado" value={brl(d.kpis.dealValue)} foot="propostas aceitas no período" />
            <Kpi label="Visitas realizadas" value={d.kpis.visitsDone} />
            <Kpi label="Propostas" value={d.kpis.proposals} foot="enviadas no período" />
            <Kpi label="Leads perdidos" value={d.kpis.lostLeads} />
            <Kpi label="Negócios" value={d.kpis.wonLeads} foot="leads do período já fechados" />
          </div>
          <div className="charts">
            <Panel title="Leads por período" sub={`${d.kpis.newLeads} no total`}><LineChart points={d.byDay.map((x) => ({ date: x.date, value: x.leads }))} /></Panel>
            <Panel title="Leads por origem"><BarList rows={sourceRows(d)} /></Panel>
            <Panel title="Conversão do funil" sub="Leads do período que chegaram em cada etapa"><Funnel steps={d.funnel.map((f) => ({ key: f.stageId, ...f }))} /></Panel>
            <Panel title="Imóveis mais procurados"><BarList rows={propertyRows(d)} empty="Nenhum lead com imóvel de interesse." /></Panel>
            <Panel title="Motivos de perda"><BarList rows={d.lostReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))} empty="Nenhuma perda registrada." /></Panel>
          </div>
          {d.brokers && (
            <section className="card">
              <div className="card-head"><div><div className="card-title">Desempenho da equipe</div><div className="card-sub">Leads que entraram no período</div></div></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Corretor</th><th>Leads</th><th>Score médio</th><th>Visitas realizadas</th><th>Propostas</th><th>Negócios</th></tr></thead>
                  <tbody>{d.brokers.map((b) => (
                    <tr key={b.brokerId ?? 'none'}><td><strong style={{ fontWeight: 550 }}>{b.name}</strong></td><td>{b.leads}</td><td><ScoreBadge score={b.avgScore} /></td><td>{b.visitsDone}</td><td>{b.proposals}</td><td>{b.won}</td></tr>
                  ))}{!d.brokers.length && <tr><td colSpan={6} className="card-sub">Nenhum lead no período.</td></tr>}</tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Kpi({ label, value, foot }: { label: string; value: string | number; foot?: string }) {
  return <div className="card stat"><div className="stat-label">{label}</div><div className="stat-value" style={{ fontSize: 32 }}>{value}</div>{foot && <div className="stat-foot">{foot}</div>}</div>;
}
export function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="card"><div className="card-head"><div><div className="card-title">{title}</div>{sub && <div className="card-sub">{sub}</div>}</div></div><div className="card-body">{children}</div></section>;
}
