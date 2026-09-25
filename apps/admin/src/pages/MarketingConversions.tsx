import { META_EVENTS, META_EVENT_LABELS, MARKETING_EVENT_STATUSES, STAGE_META_EVENTS, type Paginated } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StagePill, usePipeline } from '../components/crm';
import { MarketingTabs } from '../components/marketing';
import { Badge, Button, Empty, PageHeader, Select, SkeletonRows, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, timeAgo } from '../lib/format';

interface Ev {
  id: string; eventName: keyof typeof META_EVENT_LABELS; eventId: string; status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'; error: string | null; attempts: number;
  createdAt: string; sentAt: string | null; lead: { id: string; customer: { name: string } } | null;
}
const STATUS: Record<Ev['status'], [string, 'ok' | 'warn' | 'danger' | undefined]> = {
  SENT: ['Enviado', 'ok'], PENDING: ['Na fila', 'warn'], FAILED: ['Falhou', 'danger'], SKIPPED: ['Ignorado', undefined],
};

export function MarketingConversions() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const pipeline = usePipeline();
  const [status, setStatus] = useState('');
  const [eventName, setEventName] = useState('');
  const [page, setPage] = useState(1);
  const canManage = can('marketing.manage');

  const params = `page=${page}&pageSize=20${status ? `&status=${status}` : ''}${eventName ? `&eventName=${eventName}` : ''}`;
  const q = useQuery({ queryKey: ['mkt-events', params], queryFn: () => api<Paginated<Ev>>(`/marketing/events?${params}`), refetchInterval: 15_000, placeholderData: (p) => p });
  const setMap = useMutation({
    mutationFn: (v: { stageId: string; metaEvent: string | null }) => api(`/marketing/stage-events/${v.stageId}`, { method: 'PATCH', body: { metaEvent: v.metaEvent } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipeline'] }); toast.show('Mapeamento salvo.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/marketing/events/${id}/retry`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mkt-events'] }); toast.show('Reenviado.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Conversões" subtitle="O que enviamos à Meta para otimizar seus anúncios e o que a Meta respondeu." actions={can('marketing.capi') && <Link to="/integracoes" className="btn">Conexão com a Meta</Link>} />
      <MarketingTabs active="conversoes" />

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><div><div className="card-title">Quando avisar a Meta</div><div className="card-sub">Ao entrar numa etapa, o lead dispara o evento escolhido. Cada evento é enviado uma única vez por lead.</div></div></div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Etapa do funil</th><th>Evento enviado à Meta</th></tr></thead>
          <tbody>{pipeline.data?.stages.map((s) => (
            <tr key={s.id}>
              <td><StagePill stage={s} /></td>
              <td>{canManage ? (
                <Select style={{ width: 260 }} value={s.metaEvent ?? ''} disabled={setMap.isPending} aria-label={`Evento da etapa ${s.name}`} onChange={(e) => setMap.mutate({ stageId: s.id, metaEvent: e.target.value || null })}>
                  <option value="">Nenhum</option>{STAGE_META_EVENTS.map((m) => <option key={m} value={m}>{META_EVENT_LABELS[m]}</option>)}
                </Select>
              ) : (s.metaEvent ? META_EVENT_LABELS[s.metaEvent as keyof typeof META_EVENT_LABELS] : <span className="card-sub">Nenhum</span>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="card-sub" style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>Os eventos <strong>Lead</strong> (formulário do site) e <strong>Contato</strong> (clique no WhatsApp) são enviados automaticamente.</div>
      </section>

      <section className="card">
        <div className="filters">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todos os status</option>{MARKETING_EVENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s][0]}</option>)}</Select>
          <Select value={eventName} onChange={(e) => { setEventName(e.target.value); setPage(1); }}><option value="">Todos os eventos</option>{META_EVENTS.map((m) => <option key={m} value={m}>{META_EVENT_LABELS[m]}</option>)}</Select>
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : !d?.items.length ? <Empty icon={<Send />} title="Nenhum evento ainda" hint="Conecte a Meta em Integrações. Depois disso, leads e cliques do site aparecem aqui." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Evento</th><th>Lead</th><th>Status</th><th>Tentativas</th><th>Quando</th><th /></tr></thead>
            <tbody>{d.items.map((e) => {
              const [label, tone] = STATUS[e.status];
              return (
                <tr key={e.id}>
                  <td><strong style={{ fontWeight: 500 }}>{META_EVENT_LABELS[e.eventName] ?? e.eventName}</strong><div className="mono">{e.eventId.slice(0, 28)}</div></td>
                  <td>{e.lead ? <Link to={`/leads/${e.lead.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>{e.lead.customer.name}</Link> : <span className="card-sub">—</span>}</td>
                  <td><Badge tone={tone}>{label}</Badge>{e.error && <div className="card-sub" style={{ marginTop: 4, maxWidth: 320, color: e.status === 'FAILED' ? 'var(--danger)' : undefined }}>{e.error}</div>}</td>
                  <td className="num">{e.attempts}</td>
                  <td className="card-sub" title={dateTime(e.createdAt)} style={{ whiteSpace: 'nowrap' }}>{timeAgo(e.createdAt)}</td>
                  <td className="actions">{e.status === 'FAILED' && canManage && <Button variant="ghost" onClick={() => retry.mutate(e.id)} disabled={retry.isPending}><RotateCw /> Reenviar</Button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>{d.total} eventos · página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </section>
      {toast.node}
    </>
  );
}
