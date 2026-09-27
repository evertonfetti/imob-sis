import type { ClientDto, ClientInput } from '@imob/types';
import { LICENSE_STATUS_LABELS } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, SkeletonRows, errorMessage, fieldErrors } from '../components/ui';
import { api } from '../lib/api';

const statusTone = (s: string) => (s === 'ACTIVE' || s === 'TRIALING' ? 'ok' : s === 'PAST_DUE' ? 'warn' : 'danger') as 'ok' | 'warn' | 'danger';

export function Clients() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['clients'], queryFn: () => api<ClientDto[]>('/clients') });

  return (
    <>
      <PageHeader title="Clientes" subtitle="Cada cliente é uma imobiliária: uma instalação (VPS) por licença." actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus /> Novo cliente</Button>} />
      <div className="card">
        {list.isLoading ? <SkeletonRows /> : !list.data?.length ? (
          <Empty icon={<Users />} title="Nenhum cliente cadastrado" hint="Crie o primeiro cliente para gerar uma licença." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Contato</th><th>Licenças</th></tr></thead>
              <tbody>
                {list.data.map((c) => (
                  <tr key={c.id} className="row-link" onClick={() => nav(`/clientes/${c.id}`)}>
                    <td><strong>{c.name}</strong></td>
                    <td className="card-sub">{c.contactName ?? c.contactEmail ?? c.contactPhone ?? '—'}</td>
                    <td>
                      {c.licenses.length === 0 ? <span className="card-sub">Nenhuma</span> : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {c.licenses.map((l) => <Badge key={l.id} tone={statusTone(l.status)}>{l.planName} · {LICENSE_STATUS_LABELS[l.status]}</Badge>)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <NewClientModal onClose={() => setCreating(false)} onDone={(id) => { qc.invalidateQueries({ queryKey: ['clients'] }); setCreating(false); nav(`/clientes/${id}`); }} />}
    </>
  );
}

function NewClientModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState<ClientInput>({ name: '', contactName: '', contactEmail: '', contactPhone: '', notes: '' });
  const [err, setErr] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: () => api<ClientDto>('/clients', { method: 'POST', body: f }),
    onSuccess: (c) => onDone(c.id),
    onError: setErr,
  });
  const fe = fieldErrors(err);
  return (
    <Modal title="Novo cliente" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Criar</Button></>}>
      {err != null && !Object.keys(fe).length && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
      <div className="form-grid">
        <Field label="Nome da imobiliária" error={fe.name} className="span-2"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Pessoa de contato"><Input value={f.contactName ?? ''} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Telefone"><Input value={f.contactPhone ?? ''} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        <Field label="E-mail" error={fe.contactEmail} className="span-2"><Input type="email" value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
