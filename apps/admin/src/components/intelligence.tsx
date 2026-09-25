import { HOT_SCORE, TEMPERATURE_LABELS, WARM_SCORE, temperatureOf, type AlertDto, type LeadMatchDto, type LeadScoreDto, type MatchResult, type PropertyMatchDto } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Flame, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { Badge, Modal } from './ui';

const TONE = { HOT: 'danger', WARM: 'warn', COLD: undefined } as const;

/** Selo do score: "Quente · 70". Frio fica discreto. */
export function ScoreBadge({ score, onClick }: { score: number; onClick?: () => void }) {
  const t = temperatureOf(score);
  const el = <Badge tone={TONE[t]} plain>{t === 'HOT' && <Flame size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}{TEMPERATURE_LABELS[t]} · {score}</Badge>;
  return onClick ? <button type="button" className="badge-btn" onClick={onClick} title="Ver como o score foi calculado">{el}</button> : el;
}

export function ScoreModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['lead-score', leadId], queryFn: () => api<LeadScoreDto>(`/leads/${leadId}/score`) });
  const s = q.data;
  return (
    <Modal title="Score do lead" onClose={onClose}>
      {!s ? <div className="skeleton" style={{ height: 120 }} /> : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="stat-value" style={{ marginTop: 0 }}>{s.score}</span><span className="card-sub">de 100 · <ScoreBadge score={s.score} /></span>
          </div>
          <div className="bar-track" style={{ height: 8 }}><i style={{ width: `${s.score}%` }} /></div>
          <ul className="score-list">
            {s.factors.map((f) => (
              <li key={f.key} className={f.earned ? 'on' : ''}><span className="score-tick">{f.earned ? <Check size={13} /> : null}</span><span>{f.label}</span><strong>+{f.points}</strong></li>
            ))}
          </ul>
          <p className="card-sub">Frio abaixo de {WARM_SCORE}, morno de {WARM_SCORE} a {HOT_SCORE - 1}, quente a partir de {HOT_SCORE}. O score sobe sozinho conforme o lead avança e nunca passa de 100.</p>
        </div>
      )}
    </Modal>
  );
}

/** Imóveis sugeridos para o lead. */
export function LeadMatches({ leadId }: { leadId: string }) {
  const q = useQuery({ queryKey: ['lead-matches', leadId], queryFn: () => api<MatchResult<PropertyMatchDto>>(`/leads/${leadId}/matches`) });
  const d = q.data;
  return (
    <section className="card">
      <div className="card-head"><div className="card-title">Imóveis compatíveis</div><Sparkles size={15} style={{ color: 'var(--faint)' }} /></div>
      <div className="section-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {q.isLoading ? <div className="skeleton" style={{ height: 60 }} /> : d?.insufficientData ? (
          <div className="card-sub" style={{ padding: '10px 0' }}>Preencha o orçamento, a cidade ou os dormitórios em “Interesse” para ver sugestões.</div>
        ) : !d?.items.length ? (
          <div className="card-sub" style={{ padding: '10px 0' }}>Nenhum imóvel disponível combina com o que o cliente procura{d?.criteria.length ? ` (${d.criteria.join(', ')})` : ''}.</div>
        ) : d.items.map((m) => (
          <Link key={m.propertyId} to={`/imoveis/${m.propertyId}`} className="match">
            <div className="match-pic">{m.property.coverUrl ? <img src={m.property.coverUrl} alt="" loading="lazy" /> : null}</div>
            <div className="match-body">
              <div className="match-title"><strong>{m.property.code}</strong><span className="match-score">{m.score}%</span></div>
              <div className="card-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.property.title}</div>
              <div className="card-sub">{brl(m.property.price)}{m.property.neighborhood ? ` · ${m.property.neighborhood}` : ''}</div>
              <div className="match-reasons">{m.reasons.slice(0, 3).map((r) => <span key={r}>{r}</span>)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Leads que combinam com o imóvel (tela do imóvel). */
export function PropertyMatches({ propertyId }: { propertyId: string }) {
  const q = useQuery({ queryKey: ['property-matches', propertyId], queryFn: () => api<MatchResult<LeadMatchDto>>(`/properties/${propertyId}/matches`) });
  return (
    <section className="card">
      <div className="card-head"><div className="section-title">Leads compatíveis</div><Sparkles size={15} style={{ color: 'var(--faint)' }} /></div>
      <div className="section-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
        {q.isLoading ? <div className="skeleton" style={{ height: 48 }} /> : !q.data?.items.length ? <div className="card-sub" style={{ padding: '8px 0' }}>Nenhum lead em aberto combina com este imóvel.</div> : q.data.items.map((m) => (
          <Link key={m.leadId} to={`/leads/${m.leadId}`} className="mini-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{m.lead.customerName}</div><div className="card-sub">{m.lead.brokerName ?? 'Sem corretor'} · {m.reasons.slice(0, 2).join(' · ')}</div></div>
            <span className="match-score">{m.score}%</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const SEV_TONE = { high: 'danger', medium: 'warn', low: undefined } as const;

/** Lista de alertas ("Precisa de atenção"). */
export function AttentionCard({ limit = 6 }: { limit?: number }) {
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api<{ total: number; high: number; items: AlertDto[] }>('/alerts'), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="card-title">Precisa de atenção</div><div className="card-sub">Situações que pedem uma ação sua</div></div>
        {!!d?.total && <Badge tone={d.high ? 'danger' : 'warn'}>{d.total}</Badge>}
      </div>
      {q.isLoading ? <div className="empty"><span>Carregando…</span></div> : !d?.items.length ? (
        <div className="empty"><Check /><strong>Tudo em dia</strong><span>Nenhum alerta no momento.</span></div>
      ) : (
        <ul className="alerts">
          {d.items.slice(0, limit).map((a) => (
            <li key={a.id}>
              <Link to={a.href}>
                <span className={`alert-dot ${SEV_TONE[a.severity] ?? ''}`}><AlertTriangle size={13} /></span>
                <span className="alert-text"><strong>{a.title}</strong><small>{a.description}</small></span>
              </Link>
            </li>
          ))}
          {d.total > limit && <li className="alerts-more">+ {d.total - limit} outros alertas</li>}
        </ul>
      )}
    </section>
  );
}
