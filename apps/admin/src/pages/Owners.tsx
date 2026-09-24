import { OWNER_TYPES, type OwnerInput, type Paginated } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export interface Owner {
  id: string; type: 'PERSON' | 'COMPANY'; name: string; document: string | null; email: string | null; phone: string | null;
  whatsapp: string | null; address: string | null; city: string | null; state: string | null; notes: string | null;
  _count?: { properties: number };
}

export function Owners() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Owner | 'new' | null>(null);
  const toast = useToast();
  const q = useQuery({
    queryKey: ['owners', search, page],
    queryFn: () => api<Paginated<Owner>>(`/owners?page=${page}&pageSize=15${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (p) => p,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/owners/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['owners'] }); toast.show('Proprietário excluído.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Proprietários" subtitle="Quem é dono dos imóveis que você administra."
        actions={can('property.create') && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Novo proprietário</Button>} />
      <div className="card">
        <div className="card-head">
          <div className="input-icon" style={{ width: 320, maxWidth: '100%' }}>
            <Search /><Input placeholder="Buscar por nome, documento ou contato" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <span className="card-sub">{d ? `${d.total} ${d.total === 1 ? 'proprietário' : 'proprietários'}` : ''}</span>
        </div>
        {q.isLoading ? <SkeletonRows /> : !d?.items.length ? <Empty icon={<UserRound />} title="Nenhum proprietário encontrado" hint="Cadastre o primeiro para vinculá-lo aos imóveis." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Proprietário</th><th>Tipo</th><th>Contato</th><th>Cidade</th><th>Imóveis</th><th /></tr></thead>
              <tbody>
                {d.items.map((o) => (
                  <tr key={o.id}>
                    <td><strong style={{ fontWeight: 500 }}>{o.name}</strong><div className="card-sub">{o.document ?? 'Sem documento'}</div></td>
                    <td><Badge plain>{o.type === 'PERSON' ? 'Pessoa física' : 'Empresa'}</Badge></td>
                    <td className="card-sub">{o.phone ?? o.whatsapp ?? o.email ?? '—'}</td>
                    <td>{[o.city, o.state].filter(Boolean).join(' / ') || '—'}</td>
                    <td>{o._count?.properties ?? 0}</td>
                    <td className="actions">
                      <Button variant="ghost" onClick={() => setEditing(o)}>Editar</Button>
                      {can('property.delete') && !o._count?.properties && (
                        <Button variant="ghost" className="btn-danger" onClick={() => confirm(`Excluir ${o.name}?`) && remove.mutate(o.id)}>Excluir</Button>
                      )}
                    </td>
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
      {editing && <OwnerModal owner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(_, m) => { setEditing(null); toast.show(m); }} />}
      {toast.node}
    </>
  );
}

export function OwnerModal({ owner, onClose, onSaved }: { owner: Owner | null; onClose: () => void; onSaved: (o: Owner, message: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    type: owner?.type ?? 'PERSON', name: owner?.name ?? '', document: owner?.document ?? '', email: owner?.email ?? '', phone: owner?.phone ?? '',
    whatsapp: owner?.whatsapp ?? '', address: owner?.address ?? '', city: owner?.city ?? '', state: owner?.state ?? '', notes: owner?.notes ?? '',
  });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])) as unknown as OwnerInput;
      return owner ? api<Owner>(`/owners/${owner.id}`, { method: 'PATCH', body }) : api<Owner>('/owners', { method: 'POST', body });
    },
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ['owners'] }); onSaved(o, owner ? 'Proprietário atualizado.' : 'Proprietário criado.'); },
    onError: setErr,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); e.stopPropagation(); setErr(null); save.mutate(); };
  return (
    <Modal title={owner ? 'Editar proprietário' : 'Novo proprietário'} onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" form="owner-form" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></>}>
      <form id="owner-form" className="form-grid" onSubmit={submit}>
        {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
        <Field label="Tipo"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'PERSON' | 'COMPANY' })}>{OWNER_TYPES.map((t) => <option key={t} value={t}>{t === 'PERSON' ? 'Pessoa física' : 'Empresa'}</option>)}</Select></Field>
        <Field label={f.type === 'PERSON' ? 'CPF' : 'CNPJ'}><Input {...bind('document')} /></Field>
        <Field label="Nome" className="span-2" error={fe.name}><Input required {...bind('name')} /></Field>
        <Field label="E-mail" error={fe.email}><Input type="email" {...bind('email')} /></Field>
        <Field label="Telefone"><Input {...bind('phone')} /></Field>
        <Field label="WhatsApp"><Input {...bind('whatsapp')} /></Field>
        <Field label="Cidade"><Input {...bind('city')} /></Field>
        <Field label="Endereço" className="span-2"><Input {...bind('address')} /></Field>
        <Field label="UF" error={fe.state}><Input maxLength={2} {...bind('state')} /></Field>
        <Field label="Observações" className="span-2"><textarea className="input textarea" style={{ minHeight: 80 }} {...bind('notes')} /></Field>
      </form>
    </Modal>
  );
}
