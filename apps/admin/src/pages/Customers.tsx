import type { Paginated } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Contact, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { StagePill } from '../components/crm';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatPhone, timeAgo } from '../lib/format';

interface Customer { id: string; name: string; phone: string | null; email: string | null; document: string | null; notes: string | null; createdAt: string; _count?: { leads: number } }
interface CustomerDetail extends Customer {
  leads: { id: string; createdAt: string; source: string; property: { id: string; code: string; title: string } | null; stage: { name: string; color: string } | null; broker: { name: string } | null }[];
}

export function Customers() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => api<Paginated<Customer>>(`/customers?page=${page}&pageSize=15${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  return (
    <>
      <PageHeader title="Clientes" subtitle="Todas as pessoas que já entraram em contato ou foram cadastradas."
        actions={can('lead.create') && <Button variant="primary" onClick={() => setOpen('new')}><Plus /> Novo cliente</Button>} />
      <div className="card">
        <div className="card-head">
          <div className="input-icon" style={{ width: 320, maxWidth: '100%' }}><Search /><Input placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
          <span className="card-sub">{d ? `${d.total} ${d.total === 1 ? 'cliente' : 'clientes'}` : ''}</span>
        </div>
        {q.isLoading ? <SkeletonRows /> : !d?.items.length ? <Empty icon={<Contact />} title="Nenhum cliente encontrado" hint="Clientes são criados automaticamente quando alguém preenche o formulário do site." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Cliente</th><th>Contato</th><th>Leads</th><th>Cadastro</th><th /></tr></thead>
              <tbody>
                {d.items.map((c) => (
                  <tr key={c.id} className="row-link" onClick={() => setOpen(c.id)}>
                    <td><strong style={{ fontWeight: 500 }}>{c.name}</strong>{c.document && <div className="card-sub">{c.document}</div>}</td>
                    <td className="card-sub">{formatPhone(c.phone) || '—'}{c.email ? <div>{c.email}</div> : null}</td>
                    <td><Badge plain>{c._count?.leads ?? 0}</Badge></td>
                    <td className="card-sub">{timeAgo(c.createdAt)}</td>
                    <td className="actions"><Button variant="ghost">Abrir</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>Página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
      {open && <CustomerModal id={open === 'new' ? null : open} onClose={() => setOpen(null)} onSaved={(m) => { setOpen(null); toast.show(m); }} />}
      {toast.node}
    </>
  );
}

function CustomerModal({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: (m: string) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const detail = useQuery({ queryKey: ['customer', id], enabled: !!id, queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  const c = detail.data;
  const [f, setF] = useState<{ name: string; phone: string; email: string; document: string; notes: string } | null>(id ? null : { name: '', phone: '', email: '', document: '', notes: '' });
  const form = f ?? (c ? { name: c.name, phone: c.phone ?? '', email: c.email ?? '', document: c.document ?? '', notes: c.notes ?? '' } : null);
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const save = useMutation({
    mutationFn: () => { const body = Object.fromEntries(Object.entries(form!).map(([k, v]) => [k, v === '' ? null : v])); return id ? api(`/customers/${id}`, { method: 'PATCH', body }) : api('/customers', { method: 'POST', body }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['customer', id] }); onSaved(id ? 'Cliente atualizado.' : 'Cliente criado.'); },
    onError: setErr,
  });
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...form!, [k]: e.target.value });
  const canEdit = id ? can('lead.edit') : can('lead.create');
  return (
    <Modal title={id ? 'Cliente' : 'Novo cliente'} onClose={onClose}
      footer={canEdit && form ? <><Button type="button" onClick={onClose}>Fechar</Button><Button variant="primary" form="customer-form" disabled={save.isPending}>Salvar</Button></> : <Button onClick={onClose}>Fechar</Button>}>
      {!form ? <SkeletonRows rows={4} /> : (
        <>
          <form id="customer-form" className="form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); }}>
            {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
            <Field label="Nome" className="span-2" error={fe.name}><Input required value={form.name} onChange={set('name')} disabled={!canEdit} /></Field>
            <Field label="Telefone / WhatsApp"><Input value={form.phone} onChange={set('phone')} disabled={!canEdit} /></Field>
            <Field label="E-mail" error={fe.email}><Input type="email" value={form.email} onChange={set('email')} disabled={!canEdit} /></Field>
            <Field label="CPF / CNPJ" className="span-2"><Input value={form.document} onChange={set('document')} disabled={!canEdit} /></Field>
            <Field label="Observações" className="span-2"><textarea className="input textarea" style={{ minHeight: 70 }} value={form.notes} onChange={set('notes')} disabled={!canEdit} /></Field>
          </form>
          {c && (
            <div style={{ marginTop: 22 }}>
              <div className="grp-title">Leads deste cliente</div>
              {c.leads.length === 0 ? <div className="card-sub">Nenhum lead ainda.</div> : c.leads.map((l) => (
                <div key={l.id} className="kvrow" style={{ alignItems: 'center' }}>
                  <span><Link to={`/leads/${l.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>{l.property ? `${l.property.code} · ${l.property.title}` : 'Lead geral'}</Link><div className="card-sub">{timeAgo(l.createdAt)}{l.broker ? ` · ${l.broker.name}` : ''}</div></span>
                  <span><StagePill stage={l.stage} /></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
