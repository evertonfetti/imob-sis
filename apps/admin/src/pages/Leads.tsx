import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadSource, type LeadStatus, type Paginated } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NewLeadModal, StagePill, useBrokers, usePipeline } from '../components/crm';
import { useAuth } from '../lib/auth';
import { Badge, Button, Empty, Input, PageHeader, Select, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { formatPhone as fmtPhone, timeAgo } from '../lib/format';

interface Lead {
  id: string; source: LeadSource; status: LeadStatus; notes: string | null; createdAt: string;
  stage: { id: string; name: string; color: string } | null;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  property: { id: string; code: string; title: string } | null;
  broker: { id: string; name: string } | null;
  attribution: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; fbclid: string | null; gclid: string | null } | null;
}

const STATUS_TONE: Record<LeadStatus, 'ok' | 'warn' | 'danger' | 'accent' | undefined> = {
  NEW: 'accent', CONTACTED: 'warn', QUALIFIED: 'warn', WON: 'ok', LOST: 'danger',
};

const formatPhone = (d: string | null) => (d ? fmtPhone(d) : '—');

export function Leads() {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [sp] = useSearchParams();
  const [stageId, setStageId] = useState(sp.get('stageId') ?? '');
  const [brokerId, setBrokerId] = useState('');
  const [newLead, setNewLead] = useState(false);
  const [page, setPage] = useState(1);
  const nav = useNavigate();
  const { can } = useAuth();
  const pipeline = usePipeline();
  const brokers = useBrokers();
  const params = `page=${page}&pageSize=15${search ? `&search=${encodeURIComponent(search)}` : ''}${source ? `&source=${source}` : ''}${stageId ? `&stageId=${stageId}` : ''}${brokerId ? `&brokerId=${brokerId}` : ''}`;
  const q = useQuery({ queryKey: ['leads', params], queryFn: () => api<Paginated<Lead>>(`/leads?${params}`), placeholderData: (p) => p });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Leads" subtitle="Todos os contatos, de qualquer origem."
        actions={can('lead.create') && <Button variant="primary" onClick={() => setNewLead(true)}>Novo lead</Button>} />
      <div className="card">
        <div className="filters">
          <div className="input-icon"><Search /><Input placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} /></div>
          <Select value={source} onChange={(e) => { setSource(e.target.value); reset(); }}>
            <option value="">Origem</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>)}
          </Select>
          <Select value={stageId} onChange={(e) => { setStageId(e.target.value); reset(); }}>
            <option value="">Etapa</option>{pipeline.data?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {can('lead.view_all') && (
            <Select value={brokerId} onChange={(e) => { setBrokerId(e.target.value); reset(); }}>
              <option value="">Responsável</option><option value="none">Sem responsável</option>{brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : !d?.items.length ? (
          <Empty icon={<UserPlus />} title="Nenhum lead por aqui" hint="Quando alguém preencher o formulário do site, o contato aparece aqui." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Contato</th><th>Imóvel de interesse</th><th>Origem</th><th>Corretor</th><th>Etapa</th><th>Recebido</th><th /></tr></thead>
              <tbody>
                {d.items.map((l) => (
                  <tr key={l.id} className="row-link" onClick={() => nav(`/leads/${l.id}`)}>
                    <td><strong style={{ fontWeight: 500 }}>{l.customer.name}</strong><div className="card-sub">{formatPhone(l.customer.phone)}{l.customer.email ? ` · ${l.customer.email}` : ''}</div>
                      {l.notes && <div className="card-sub" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.notes}>“{l.notes}”</div>}</td>
                    <td>{l.property ? <Link to={`/imoveis/${l.property.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', fontWeight: 500 }}>{l.property.code}</Link> : <span className="card-sub">Geral</span>}
                      {l.property && <div className="card-sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.property.title}</div>}</td>
                    <td><Badge plain>{LEAD_SOURCE_LABELS[l.source]}</Badge>
                      {(l.attribution?.utmCampaign || l.attribution?.utmSource) && <div className="card-sub" style={{ marginTop: 4 }}>{[l.attribution.utmSource, l.attribution.utmCampaign].filter(Boolean).join(' · ')}</div>}</td>
                    <td className="card-sub">{l.broker?.name ?? 'Sem corretor'}</td>
                    <td><StagePill stage={l.stage} /></td>
                    <td className="card-sub" style={{ whiteSpace: 'nowrap' }}>{timeAgo(l.createdAt)}</td>
                    <td className="actions">
                      {l.customer.phone && (
                        <a className="btn btn-ghost btn-icon" onClick={(e) => e.stopPropagation()} href={`https://wa.me/55${l.customer.phone}`} target="_blank" rel="noreferrer" title="Abrir no WhatsApp" aria-label="Abrir no WhatsApp"><MessageCircle size={16} /></a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>{d.total} leads · página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
      {newLead && <NewLeadModal onClose={() => setNewLead(false)} onCreated={(id) => { setNewLead(false); nav(`/leads/${id}`); }} />}
    </>
  );
}