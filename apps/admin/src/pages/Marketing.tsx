import type { CampaignRow, SourceRow } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MarketingTabs, PeriodPicker, RateBar, pct } from '../components/marketing';
import { Empty, PageHeader, Select, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { brl } from '../lib/money';

interface Overview {
  days: number; leads: number; qualified: number; won: number; lost: number; whatsappClicks: number; qualifiedRate: number; wonRate: number;
  series: { day: string; leads: number }[]; events: Record<string, number>;
}

const CHANNELS: Record<string, string> = { SITE: 'Site', WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', GOOGLE: 'Google', PORTAL: 'Portal', REFERRAL: 'Indicação', PHONE: 'Telefone', MANUAL: 'Manual' };

export function MarketingOverview() {
  const [days, setDays] = useState(30);
  const ov = useQuery({ queryKey: ['mkt-overview', days], queryFn: () => api<Overview>(`/marketing/overview?days=${days}`), placeholderData: (p) => p });
  const camps = useQuery({ queryKey: ['mkt-campaigns', days], queryFn: () => api<CampaignRow[]>(`/marketing/campaigns?days=${days}`), placeholderData: (p) => p });
  const o = ov.data;
  const max = Math.max(1, ...(o?.series.map((s) => s.leads) ?? [1]));
  const ev = o?.events ?? {};

  return (
    <>
      <PageHeader title="Marketing" subtitle="De onde vêm os leads e quais deles viram negócio." actions={<PeriodPicker value={days} onChange={setDays} />} />
      <MarketingTabs active="geral" />
      {!o ? <div className="card"><SkeletonRows rows={6} /></div> : (
        <>
          <div className="kpis">
            <div className="card kpi"><div className="kpi-label">Leads</div><div className="kpi-value">{o.leads}</div><div className="kpi-foot">nos últimos {o.days} dias</div></div>
            <div className="card kpi"><div className="kpi-label">Qualificados</div><div className="kpi-value">{o.qualified}</div><div className="kpi-foot">{pct(o.qualifiedRate)} dos leads</div></div>
            <div className="card kpi"><div className="kpi-label">Fechados</div><div className="kpi-value">{o.won}</div><div className="kpi-foot">{pct(o.wonRate)} dos leads · {o.lost} perdidos</div></div>
            <div className="card kpi"><div className="kpi-label">Cliques no WhatsApp</div><div className="kpi-value">{o.whatsappClicks}</div><div className="kpi-foot">a partir do site</div></div>
          </div>

          <div className="two-col" style={{ alignItems: 'start' }}>
            <section className="card">
              <div className="card-head"><div><div className="card-title">Leads por dia</div><div className="card-sub">Horário de Brasília</div></div></div>
              <div className="section-body">
                {o.leads === 0 ? <Empty icon={<BarChart3 />} title="Nenhum lead no período" hint="Quando os leads chegarem, o gráfico aparece aqui." /> : (
                  <>
                    <div className="chart" role="img" aria-label={`Leads por dia nos últimos ${o.days} dias`}>
                      {o.series.map((s) => (
                        <div key={s.day} className={`bar-col ${s.leads === 0 ? 'zero' : ''}`} title={`${new Date(`${s.day}T12:00:00`).toLocaleDateString('pt-BR')}: ${s.leads} ${s.leads === 1 ? 'lead' : 'leads'}`}>
                          <i style={{ height: `${Math.max(2, (s.leads / max) * 100)}%` }} />
                        </div>
                      ))}
                    </div>
                    <div className="chart-axis"><span>{new Date(`${o.series[0]!.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span><span>pico: {max} {max === 1 ? 'lead' : 'leads'}/dia</span><span>hoje</span></div>
                  </>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><div><div className="card-title">Envio de conversões à Meta</div><div className="card-sub">Últimos {o.days} dias</div></div><Link to="/marketing/conversoes" className="btn btn-ghost">Ver histórico</Link></div>
              <div className="section-body">
                <div className="kvrow"><span>Enviados</span><span>{ev.SENT ?? 0}</span></div>
                <div className="kvrow"><span>Falharam</span><span style={{ color: (ev.FAILED ?? 0) > 0 ? 'var(--danger)' : undefined, fontWeight: (ev.FAILED ?? 0) > 0 ? 600 : undefined }}>{ev.FAILED ?? 0}</span></div>
                <div className="kvrow"><span>Ignorados (sem consentimento)</span><span>{ev.SKIPPED ?? 0}</span></div>
                <div className="kvrow"><span>Na fila</span><span>{ev.PENDING ?? 0}</span></div>
              </div>
            </section>
          </div>

          <section className="card" style={{ marginTop: 20 }}>
            <div className="card-head"><div className="card-title">Principais campanhas</div><Link to="/marketing/campanhas" className="btn btn-ghost">Ver todas</Link></div>
            {camps.isLoading ? <SkeletonRows rows={4} /> : !camps.data?.length ? <Empty icon={<BarChart3 />} title="Sem campanhas no período" /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Campanha</th><th>Origem</th><th className="num">Leads</th><th>Qualificados</th><th>Fechados</th></tr></thead>
                <tbody>{camps.data.slice(0, 5).map((c) => (
                  <tr key={`${c.campaign}|${c.source}|${c.medium}`}>
                    <td><strong style={{ fontWeight: 500 }}>{c.campaign}</strong></td>
                    <td className="card-sub">{c.source}{c.medium ? ` / ${c.medium}` : ''}</td>
                    <td className="num">{c.leads}</td><td><RateBar value={c.qualifiedRate} count={c.qualified} /></td><td><RateBar value={c.wonRate} count={c.won} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function MarketingCampaigns() {
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<'leads' | 'qualifiedRate' | 'wonRate' | 'wonValue'>('leads');
  const q = useQuery({ queryKey: ['mkt-campaigns', days], queryFn: () => api<CampaignRow[]>(`/marketing/campaigns?days=${days}`), placeholderData: (p) => p });
  const rows = [...(q.data ?? [])].sort((a, b) => (b[sort] as number) - (a[sort] as number) || b.leads - a.leads);
  // "Melhor qualidade": maior taxa de qualificação entre campanhas com volume mínimo (evita 1 lead = 100%).
  const eligible = rows.filter((r) => r.leads >= 5 && r.qualified > 0);
  const best = eligible.length ? eligible.reduce((a, b) => (b.qualifiedRate > a.qualifiedRate ? b : a)) : null;

  return (
    <>
      <PageHeader title="Campanhas" subtitle="Quais campanhas trazem leads que realmente avançam no funil." actions={<PeriodPicker value={days} onChange={setDays} />} />
      <MarketingTabs active="campanhas" />
      <div className="card">
        <div className="card-head">
          <span className="card-sub">{rows.length} {rows.length === 1 ? 'campanha' : 'campanhas'} · leads agrupados por <code>utm_campaign</code></span>
          <Select style={{ width: 210 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar por">
            <option value="leads">Mais leads</option><option value="qualifiedRate">Maior taxa de qualificação</option><option value="wonRate">Maior taxa de fechamento</option><option value="wonValue">Maior valor fechado</option>
          </Select>
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : !rows.length ? <Empty icon={<BarChart3 />} title="Sem dados no período" hint="Use links com utm_campaign nos seus anúncios para acompanhar cada campanha." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Campanha</th><th>Origem / mídia</th><th className="num">Leads</th><th>Qualificados</th><th>Fechados</th><th className="num">Valor fechado</th><th className="num">Cliques WhatsApp</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={`${c.campaign}|${c.source}|${c.medium}`}>
                <td><strong style={{ fontWeight: 500 }}>{c.campaign}</strong>{best && best === c && <div className="best">● Melhor qualidade</div>}</td>
                <td className="card-sub">{c.source}{c.medium ? ` / ${c.medium}` : ''}</td>
                <td className="num">{c.leads}</td>
                <td><RateBar value={c.qualifiedRate} count={c.qualified} /></td>
                <td><RateBar value={c.wonRate} count={c.won} /></td>
                <td className="num">{c.wonValue ? brl(c.wonValue) : '—'}</td>
                <td className="num">{c.whatsappClicks}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <p className="card-sub" style={{ marginTop: 12 }}>“Qualificado” conta os leads que já passaram por uma etapa qualificadora do funil, mesmo que hoje estejam em outra. O investimento em anúncios ainda não é importado, então o custo por lead não aparece aqui.</p>
    </>
  );
}

function SourceTable({ title, rows, label }: { title: string; rows: SourceRow[]; label: (k: string) => string }) {
  return (
    <section className="card">
      <div className="card-head"><div className="card-title">{title}</div></div>
      {!rows.length ? <Empty icon={<BarChart3 />} title="Sem dados" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Origem</th><th className="num">Leads</th><th>Qualificados</th><th>Fechados</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key}><td>{label(r.key)}</td><td className="num">{r.leads}</td><td><RateBar value={r.qualifiedRate} count={r.qualified} /></td><td><RateBar value={r.wonRate} count={r.won} /></td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}

export function MarketingSources() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['mkt-sources', days], queryFn: () => api<{ channels: SourceRow[]; utm: SourceRow[] }>(`/marketing/sources?days=${days}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Origem dos leads" subtitle="Por canal de entrada e pela fonte dos anúncios (utm_source)." actions={<PeriodPicker value={days} onChange={setDays} />} />
      <MarketingTabs active="origens" />
      {!q.data ? <div className="card"><SkeletonRows rows={6} /></div> : (
        <div className="two-col" style={{ alignItems: 'start' }}>
          <SourceTable title="Por canal" rows={q.data.channels} label={(k) => CHANNELS[k] ?? k} />
          <SourceTable title="Por fonte de anúncio" rows={q.data.utm} label={(k) => k} />
        </div>
      )}
    </>
  );
}
