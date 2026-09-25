import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { AgentActivityCard, AgentCard, KnowledgeCard, AgentTestCard } from '../components/AgentSettings';
import { AiAccountsCard, AiDefaultsCard } from '../components/AiAccounts';
import { WatermarkCard } from '../components/ImagesAiSettings';
import { IntelligenceSettingsCard } from '../components/IntelligenceSettings';
import { api } from '../lib/api';

type Company = Record<string, string | null>;

interface Branch {
  id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null;
  address: string | null; city: string | null; state: string | null; zipCode: string | null; active: boolean;
}

export function CompanyPage() {
  const [sp] = useSearchParams();
  const initial = (['branches', 'alerts', 'images', 'agent'] as const).find((t) => t === sp.get('aba'));
  const [tab, setTab] = useState<'company' | 'branches' | 'alerts' | 'images' | 'agent'>(initial ?? 'company');
  return (
    <>
      <PageHeader title="Empresa e filiais" subtitle="Dados institucionais e unidades de atendimento." />
      <div className="tabs" role="tablist">
        <button className={`tab ${tab === 'company' ? 'active' : ''}`} role="tab" onClick={() => setTab('company')}>Empresa</button>
        <button className={`tab ${tab === 'branches' ? 'active' : ''}`} role="tab" onClick={() => setTab('branches')}>Filiais</button>
        <button className={`tab ${tab === 'alerts' ? 'active' : ''}`} role="tab" onClick={() => setTab('alerts')}>Alertas e automações</button>
        <button className={`tab ${tab === 'images' ? 'active' : ''}`} role="tab" onClick={() => setTab('images')}>Imagens e IA</button>
        <button className={`tab ${tab === 'agent' ? 'active' : ''}`} role="tab" onClick={() => setTab('agent')}>Agente de atendimento</button>
      </div>
      {tab === 'company' ? <CompanyForm /> : tab === 'branches' ? <Branches /> : tab === 'alerts' ? <IntelligenceSettingsCard /> : tab === 'images' ? <div className="stack"><AiAccountsCard /><AiDefaultsCard /><WatermarkCard /></div> : <div className="stack"><AgentCard onGoToAccounts={() => setTab('images')} /><KnowledgeCard /><AgentTestCard /><AgentActivityCard /></div>}
    </>
  );
}

const COMPANY_FIELDS = ['name', 'tradeName', 'document', 'creci', 'email', 'phone', 'whatsapp', 'website', 'primaryColor', 'secondaryColor', 'leadDistribution'] as const;

function CompanyForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['company'], queryFn: () => api<Company>('/company') });
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) setF(Object.fromEntries(COMPANY_FIELDS.map((k) => [k, q.data[k] ?? ''])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/company', { method: 'PATCH', body: Object.fromEntries(COMPANY_FIELDS.map((k) => [k, f[k] === '' ? (k === 'leadDistribution' ? undefined : null) : f[k]])) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['company'] }); toast.show('Dados da empresa salvos.'); setErr(null); },
    onError: setErr,
  });
  const fe = fieldErrors(err);
  const bind = (k: string) => ({ value: f[k] ?? '', onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  if (q.isLoading) return <div className="card"><SkeletonRows rows={6} /></div>;
  return (
    <form className="card card-pad" onSubmit={submit}>
      {err != null && !Object.keys(fe).length && <div className="alert" style={{ marginBottom: 16 }}>{errorMessage(err)}</div>}
      <div className="form-grid">
        <Field label="Razão social" error={fe.name}><Input required {...bind('name')} /></Field>
        <Field label="Nome fantasia"><Input {...bind('tradeName')} /></Field>
        <Field label="CNPJ"><Input {...bind('document')} /></Field>
        <Field label="CRECI jurídico"><Input {...bind('creci')} /></Field>
        <Field label="E-mail" error={fe.email}><Input type="email" {...bind('email')} /></Field>
        <Field label="Site"><Input {...bind('website')} placeholder="https://" /></Field>
        <Field label="Telefone"><Input {...bind('phone')} /></Field>
        <Field label="WhatsApp"><Input {...bind('whatsapp')} /></Field>
        <Field label="Cor primária" error={fe.primaryColor} hint="Formato #RRGGBB"><ColorInput {...bind('primaryColor')} /></Field>
        <Field label="Cor secundária" error={fe.secondaryColor} hint="Formato #RRGGBB"><ColorInput {...bind('secondaryColor')} /></Field>
        <Field label="Distribuição de leads" className="span-2" hint="Como os novos leads escolhem o corretor quando o imóvel não tem um responsável. No rodízio, o corretor que está há mais tempo sem receber lead é o próximo.">
          <select className="select" value={f.leadDistribution ?? 'MANUAL'} onChange={(e) => setF({ ...f, leadDistribution: e.target.value })}>
            <option value="MANUAL">Manual (a equipe distribui)</option>
            <option value="ROUND_ROBIN">Rodízio entre corretores</option>
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
        <Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar alterações'}</Button>
      </div>
      {toast.node}
    </form>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (e: { target: { value: string } }) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input type="color" aria-label="Escolher cor" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#2c4a43'} onChange={onChange}
        style={{ width: 38, height: 38, padding: 3, border: '1px solid var(--line-strong)', borderRadius: 7, background: 'var(--surface)', cursor: 'pointer' }} />
      <Input value={value} onChange={onChange} placeholder="#2C4A43" />
    </div>
  );
}

function Branches() {
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const toast = useToast();
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-sub">{q.data ? `${q.data.length} ${q.data.length === 1 ? 'filial' : 'filiais'}` : ''}</span>
          <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Nova filial</Button>
        </div>
        {q.isLoading ? <SkeletonRows rows={3} /> : !q.data?.length ? <Empty icon={<Building2 />} title="Nenhuma filial cadastrada" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Filial</th><th>Cidade</th><th>Contato</th><th>Status</th><th /></tr></thead>
              <tbody>
                {q.data.map((b) => (
                  <tr key={b.id}>
                    <td><strong style={{ fontWeight: 500 }}>{b.name}</strong><div className="card-sub">{b.address}</div></td>
                    <td>{[b.city, b.state].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="card-sub">{b.phone ?? b.email ?? '—'}</td>
                    <td><Badge tone={b.active ? 'ok' : undefined}>{b.active ? 'Ativa' : 'Inativa'}</Badge></td>
                    <td className="actions"><Button variant="ghost" onClick={() => setEditing(b)}>Editar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <BranchModal branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast.show(m); }} />}
      {toast.node}
    </>
  );
}

function BranchModal({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: (m: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: branch?.name ?? '', phone: branch?.phone ?? '', whatsapp: branch?.whatsapp ?? '', email: branch?.email ?? '',
    address: branch?.address ?? '', city: branch?.city ?? '', state: branch?.state ?? '', zipCode: branch?.zipCode ?? '', active: branch?.active ?? true,
  });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const bind = (k: keyof typeof f) => ({ value: String(f[k]), onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])), name: f.name, active: f.active };
      return branch ? api(`/branches/${branch.id}`, { method: 'PATCH', body }) : api('/branches', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); onSaved(branch ? 'Filial atualizada.' : 'Filial criada.'); },
    onError: setErr,
  });
  return (
    <Modal title={branch ? 'Editar filial' : 'Nova filial'} onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" form="branch-form" disabled={save.isPending}>Salvar</Button></>}>
      <form id="branch-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
        <Field label="Nome" className="span-2" error={fe.name}><Input required {...bind('name')} /></Field>
        <Field label="Telefone"><Input {...bind('phone')} /></Field>
        <Field label="WhatsApp"><Input {...bind('whatsapp')} /></Field>
        <Field label="E-mail" className="span-2" error={fe.email}><Input type="email" {...bind('email')} /></Field>
        <Field label="Endereço" className="span-2"><Input {...bind('address')} /></Field>
        <Field label="Cidade"><Input {...bind('city')} /></Field>
        <Field label="UF" error={fe.state}><Input maxLength={2} {...bind('state')} /></Field>
        <Field label="CEP"><Input {...bind('zipCode')} /></Field>
        <Field label="Status"><label style={{ display: 'flex', gap: 8, alignItems: 'center', height: 38 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Filial ativa</label></Field>
      </form>
    </Modal>
  );
}
