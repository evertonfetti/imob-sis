import type { ClientDto, ClientInput, LicenseCreatedDto, PlanDto } from '@imob/types';
import { LICENSE_STATUS_LABELS } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Field, Input, Modal, Select, SkeletonRows, errorMessage } from '../components/ui';
import { api } from '../lib/api';

const statusTone = (s: string) => (s === 'ACTIVE' || s === 'TRIALING' ? 'ok' : s === 'PAST_DUE' ? 'warn' : 'danger') as 'ok' | 'warn' | 'danger';

export function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<ClientInput | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<LicenseCreatedDto | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const client = useQuery({ queryKey: ['client', id], queryFn: () => api<ClientDto>(`/clients/${id}`) });
  useEffect(() => { if (client.data && !f) setF({ name: client.data.name, contactName: client.data.contactName, contactEmail: client.data.contactEmail, contactPhone: client.data.contactPhone, notes: client.data.notes }); }, [client.data, f]);

  const save = useMutation({
    mutationFn: () => api<ClientDto>(`/clients/${id}`, { method: 'PATCH', body: f }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', id] }),
    onError: setErr,
  });

  if (client.isLoading || !f) return <SkeletonRows rows={8} />;
  if (client.error) return <div className="alert">{errorMessage(client.error)}</div>;
  const c = client.data!;

  return (
    <>
      <Link to="/" className="btn btn-ghost" style={{ marginBottom: 16 }}><ArrowLeft size={16} /> Clientes</Link>
      <div className="page-head"><div><h1 className="page-title">{c.name}</h1><p className="page-sub">Cliente desde {new Date(c.createdAt).toLocaleDateString('pt-BR')}</p></div></div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><div className="card-title">Dados do cliente</div></div>
        <div className="card-pad">
          {err != null && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
          <div className="form-grid">
            <Field label="Nome" className="span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Pessoa de contato"><Input value={f.contactName ?? ''} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={f.contactPhone ?? ''} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
            <Field label="E-mail" className="span-2"><Input type="email" value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
            <Field label="Observações" className="span-2"><Input value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 16 }}><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Licenças</div><Button onClick={() => setCreating(true)}><Plus /> Nova licença</Button></div>
        {c.licenses.length === 0 ? (
          <div className="card-pad card-sub">Nenhuma licença ainda. Crie uma para gerar a chave desta instalação.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plano</th><th>Status</th><th>Chave</th><th>Última confirmação</th></tr></thead>
              <tbody>
                {c.licenses.map((l) => (
                  <tr key={l.id} className="row-link" onClick={() => nav(`/licencas/${l.id}`)}>
                    <td>{l.planName}</td>
                    <td><Badge tone={statusTone(l.status)}>{LICENSE_STATUS_LABELS[l.status]}</Badge></td>
                    <td className="card-sub">•••• {l.keyPreview}</td>
                    <td className="card-sub">{l.lastSeenAt ? new Date(l.lastSeenAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && <NewLicenseModal clientId={id!} onClose={() => setCreating(false)} onCreated={(l) => { setCreating(false); setCreated(l); qc.invalidateQueries({ queryKey: ['client', id] }); }} />}
      {created && <KeyModal license={created} onClose={() => setCreated(null)} />}
    </>
  );
}

function NewLicenseModal({ clientId, onClose, onCreated }: { clientId: string; onClose: () => void; onCreated: (l: LicenseCreatedDto) => void }) {
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanDto[]>('/plans') });
  const [planId, setPlanId] = useState('');
  const [trialDays, setTrialDays] = useState(14);
  const [err, setErr] = useState<unknown>(null);
  const create = useMutation({
    mutationFn: () => api<LicenseCreatedDto>('/licenses', { method: 'POST', body: { clientId, planId, trialDays } }),
    onSuccess: onCreated,
    onError: setErr,
  });
  const active = plans.data?.filter((p) => p.active) ?? [];
  return (
    <Modal title="Nova licença" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!planId || create.isPending} onClick={() => create.mutate()}>Criar licença</Button></>}>
      {err != null && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
      <div className="form-grid">
        <Field label="Plano" className="span-2">
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Escolha um plano…</option>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Dias de teste grátis" hint="0 para começar direto como paga."><Input type="number" min={0} value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
}

function KeyModal({ license, onClose }: { license: LicenseCreatedDto; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Licença criada" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Concluído</Button>}>
      <p className="card-sub" style={{ marginBottom: 12 }}>Copie esta chave agora: ela não aparece de novo. Cole-a como <code>LICENSE_KEY</code> no <code>docker-compose.yml</code> da instalação do cliente, junto de <code>LICENSE_SERVER_URL</code> apontando para este servidor.</p>
      <div className="key-reveal">{license.key}</div>
      <div style={{ marginTop: 12 }}>
        <Button onClick={() => { void navigator.clipboard.writeText(license.key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>
          <Copy size={16} /> {copied ? 'Copiado!' : 'Copiar chave'}
        </Button>
      </div>
      <div className="alert" style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <KeyRound size={16} style={{ marginTop: 2, flex: 'none' }} />
        <span>A instalação se vincula sozinha na primeira confirmação. Se precisar trocar de VPS depois, gere uma nova chave ou libere o vínculo na página da licença.</span>
      </div>
    </Modal>
  );
}
