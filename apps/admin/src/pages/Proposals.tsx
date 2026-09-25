import { PROPOSAL_STATUS_LABELS, type Paginated } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { PROPOSAL_TONE, ProposalDetail, ProposalModal, pct, type ProposalRow } from '../components/commercial';
import { Badge, Button, Empty, Input, PageHeader, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { brl } from '../lib/money';

const VIEWS = [['open', 'Em aberto'], ['ACCEPTED', 'Aceitas'], ['closed', 'Encerradas'], ['', 'Todas']] as const;

export function Proposals() {
  const { can } = useAuth();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<'new' | string | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: '20', ...(view === 'open' && { open: 'true' }), ...(view === 'ACCEPTED' && { status: 'ACCEPTED' }), ...(search && { search }) }).toString();
  const q = useQuery({ queryKey: ['proposals', params], queryFn: () => api<Paginated<ProposalRow>>(`/proposals?${params}`), placeholderData: (p) => p });
  const d = q.data;
  const items = view === 'closed' ? d?.items.filter((p) => ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(p.status)) : d?.items;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Propostas" subtitle="Negociações em andamento entre compradores e proprietários."
        actions={can('proposal.create') && <Button variant="primary" onClick={() => setModal('new')}><Plus /> Nova proposta</Button>} />
      <div className="seg" role="tablist">
        {VIEWS.map(([k, label]) => <button key={k} role="tab" className={view === k ? 'active' : ''} onClick={() => { setView(k); setPage(1); }}>{label}</button>)}
      </div>
      <div className="card">
        <div className="filters">
          <div className="input-icon"><Search /><Input placeholder="Buscar por cliente, código ou título do imóvel…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        </div>
        {q.isLoading ? <SkeletonRows rows={6} /> : !items?.length ? (
          <Empty icon={<FileSignature />} title="Nenhuma proposta por aqui" hint="Registre propostas a partir do lead para acompanhar cada contraproposta." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Imóvel</th><th>Comprador</th><th>Pedido</th><th>Proposta</th><th>Situação</th><th>Atualizada</th></tr></thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setModal(p.id)}>
                    <td><strong style={{ fontWeight: 550 }}>{p.property.code}</strong><div className="card-sub">{p.property.title}</div></td>
                    <td>{p.lead.customer.name}</td>
                    <td>{brl(p.askingPrice)}</td>
                    <td><strong style={{ fontWeight: 550 }}>{brl(p.proposedPrice)}</strong><div className={`card-sub ${p.differencePct < 0 ? 'neg' : ''}`}>{pct(p.differencePct)}</div></td>
                    <td><Badge tone={PROPOSAL_TONE[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge></td>
                    <td className="card-sub">{timeAgo(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>{d.total} propostas · página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
      {modal === 'new' && <ProposalModal onClose={() => setModal(null)} onSaved={(p) => setModal(p.id)} />}
      {modal && modal !== 'new' && <ProposalDetail id={modal} onClose={() => setModal(null)} />}
    </>
  );
}
