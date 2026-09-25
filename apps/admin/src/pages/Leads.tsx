import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadSource, type LeadStatus, type Paginated } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Empty, Input, PageHeader, Select, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

interface Lead {
  id: string; source: LeadSource; status: LeadStatus; notes: string | null; createdAt: string;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  property: { id: string; code: string; title: string } | null;
  broker: { id: string; name: string } | null;
  attribution: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; fbclid: string | null; gclid: string | null } | null;
}

const STATUS_TONE: Record<LeadStatus, 'ok' | 'warn' | 'danger' | 'accent' | undefined> = {
  NEW: 'accent', CONTACTED: 'warn', QUALIFIED: 'warn', WON: 'ok', LOST: 'danger',
};

export function formatPhone(d: string | null) {
  if (!d) return '—';
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
}

export function Leads() {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const params = `page=${page}&pageSize=15${search ? `&search=${encodeURIComponent(search)}` : ''}${source ? `&source=${source}` : ''}${status ? `&status=${status}` : ''}`;
  const q = useQuery({ queryKey: ['leads', params], queryFn: () => api<Paginated<Lead>>(`/leads?${params}`), placeholderData: (p) => p });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Leads" subtitle="Contatos recebidos pelo site. O funil de atendimento chega no próximo bloco." />
      <div className="card">
        <div className="filters">
          <div className="input-icon"><Search /><Input placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} /></div>
          <Select value={source} onChange={(e) => { setSource(e.target.value); reset(); }}>
            <option value="">Origem</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
            <option value="">Status</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
          </Select>
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : !d?.items.length ? (
          <Empty icon={<UserPlus />} title="Nenhum lead por aqui" hint="Quando alguém preencher o formulário do site, o contato aparece aqui." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Contato</th><th>Imóvel de interesse</th><th>Origem</th><th>Corretor</th><th>Status</th><th>Recebido</th><th /></tr></thead>
              <tbody>
                {d.items.map((l) => (
                  <tr key={l.id}>
                    <td><strong style={{ fontWeight: 500 }}>{l.customer.name}</strong><div className="card-sub">{formatPhone(l.customer.phone)}{l.customer.email ? ` · ${l.customer.email}` : ''}</div>
                      {l.notes && <div className="card-sub" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.notes}>“{l.notes}”</div>}</td>
                    <td>{l.property ? <Link to={`/imoveis/${l.property.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>{l.property.code}</Link> : <span className="card-sub">Geral</span>}
                      {l.property && <div className="card-sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.property.title}</div>}</td>
                    <td><Badge plain>{LEAD_SOURCE_LABELS[l.source]}</Badge>
                      {(l.attribution?.utmCampaign || l.attribution?.utmSource) && <div className="card-sub" style={{ marginTop: 4 }}>{[l.attribution.utmSource, l.attribution.utmCampaign].filter(Boolean).join(' · ')}</div>}</td>
                    <td className="card-sub">{l.broker?.name ?? 'Sem corretor'}</td>
                    <td><Badge tone={STATUS_TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge></td>
                    <td className="card-sub" style={{ whiteSpace: 'nowrap' }}>{timeAgo(l.createdAt)}</td>
                    <td className="actions">
                      {l.customer.phone && (
                        <a className="btn btn-ghost btn-icon" href={`https://wa.me/55${l.customer.phone}`} target="_blank" rel="noreferrer" title="Abrir no WhatsApp" aria-label="Abrir no WhatsApp"><MessageCircle size={16} /></a>
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
    </>
  );
}
