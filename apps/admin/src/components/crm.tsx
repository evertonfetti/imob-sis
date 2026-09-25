import type { BoardCard, Paginated, StageDto } from '@imob/types';
import { LEAD_SOURCE_LABELS } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, Field, Input, Modal, Select, errorMessage, fieldErrors } from './ui';
import { SearchPicker } from './SearchPicker';

export const sourceLabel = (s: string) => LEAD_SOURCE_LABELS[s as keyof typeof LEAD_SOURCE_LABELS] ?? s;

export interface Pipeline { id: string; name: string; stages: StageDto[] }
export const usePipeline = () => useQuery({ queryKey: ['pipeline'], queryFn: () => api<Pipeline>('/pipeline'), staleTime: 60_000 });
export const useBrokers = () => useQuery({ queryKey: ['prop-options'], queryFn: () => api<{ brokers: { id: string; name: string }[] }>('/properties/options'), staleTime: 60_000 });

export const searchProperties = async (q: string) =>
  (await api<Paginated<{ id: string; code: string; title: string; city: string | null; neighborhood: string | null }>>(`/properties?pageSize=8${q ? `&search=${encodeURIComponent(q)}` : ''}`))
    .items.map((p) => ({ id: p.id, label: `${p.code} · ${p.title}`, sub: [p.neighborhood, p.city].filter(Boolean).join(', ') }));

export const searchCustomers = async (q: string) =>
  (await api<Paginated<{ id: string; name: string; phone: string | null; email: string | null }>>(`/customers?pageSize=8${q ? `&search=${encodeURIComponent(q)}` : ''}`))
    .items.map((c) => ({ id: c.id, label: c.name, sub: c.phone ?? c.email ?? undefined }));

export const searchLeads = async (q: string) =>
  (await api<Paginated<{ id: string; customer: { name: string }; property: { code: string } | null }>>(`/leads?pageSize=8${q ? `&search=${encodeURIComponent(q)}` : ''}`))
    .items.map((l) => ({ id: l.id, label: l.customer.name, sub: l.property?.code }));

export function StagePill({ stage }: { stage: { name: string; color: string } | null | undefined }) {
  if (!stage) return <span className="card-sub">—</span>;
  return <span className="stage-pill"><i style={{ background: stage.color }} />{stage.name}</span>;
}

/** Motivo obrigatório ao mover um lead para "Perdido". */
export function LostModal({ onConfirm, onClose, busy }: { onConfirm: (reason: string) => void; onClose: () => void; busy?: boolean }) {
  const [reason, setReason] = useState('');
  const options = ['Comprou com outra imobiliária', 'Desistiu da compra', 'Sem retorno do cliente', 'Fora do orçamento', 'Imóvel indisponível'];
  return (
    <Modal title="Marcar como perdido" onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="danger" disabled={reason.trim().length < 3 || busy} onClick={() => onConfirm(reason.trim())}>Confirmar perda</Button></>}>
      <div className="form-grid">
        <Field label="Qual foi o motivo?" className="span-2" hint="Esse registro ajuda a entender por que os negócios não fecham.">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Descreva o motivo" maxLength={300} />
        </Field>
        <div className="span-2 pills-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {options.map((o) => <button type="button" key={o} className="chip" style={{ height: 30 }} onClick={() => setReason(o)}>{o}</button>)}
        </div>
      </div>
    </Modal>
  );
}

/** Cadastro manual de lead (cliente existente ou novo). */
export function NewLeadModal({ onClose, onCreated, defaultStageId }: { onClose: () => void; onCreated: (leadId: string) => void; defaultStageId?: string }) {
  const qc = useQueryClient();
  const brokers = useBrokers();
  const [customer, setCustomer] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const [property, setProperty] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const [f, setF] = useState({ name: '', phone: '', email: '', source: 'MANUAL', brokerId: '', notes: '' });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const save = useMutation({
    mutationFn: () => api<{ id: string }>('/leads', {
      method: 'POST',
      body: {
        ...(customer ? { customerId: customer.id } : { customer: { name: f.name, phone: f.phone || null, email: f.email || null } }),
        propertyId: property?.id ?? null, source: f.source, notes: f.notes || null,
        ...(f.brokerId ? { brokerId: f.brokerId } : {}), ...(defaultStageId ? { stageId: defaultStageId } : {}),
      },
    }),
    onSuccess: (l) => { qc.invalidateQueries({ queryKey: ['board'] }); qc.invalidateQueries({ queryKey: ['leads'] }); onCreated(l.id); },
    onError: setErr,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); };
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Modal title="Novo lead" onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" form="lead-form" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Criar lead'}</Button></>}>
      <form id="lead-form" className="form-grid" onSubmit={submit}>
        {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
        <div className="span-2 field"><label>Cliente</label>
          <SearchPicker queryKey="pick-customer" value={customer} onChange={setCustomer} search={searchCustomers} placeholder="Buscar cliente existente (nome, telefone ou e-mail)…" />
          {!customer && <span className="field-hint">Ou preencha os dados de um novo cliente abaixo.</span>}
        </div>
        {!customer && (
          <>
            <Field label="Nome" className="span-2" error={fe['customer.name']}><Input required {...bind('name')} /></Field>
            <Field label="Telefone / WhatsApp"><Input {...bind('phone')} placeholder="(11) 90000-0000" /></Field>
            <Field label="E-mail" error={fe['customer.email']}><Input type="email" {...bind('email')} /></Field>
          </>
        )}
        <div className="span-2 field"><label>Imóvel de interesse</label>
          <SearchPicker queryKey="pick-property" value={property} onChange={setProperty} search={searchProperties} placeholder="Buscar por código, título ou bairro…" />
        </div>
        <Field label="Origem"><Select {...bind('source')}>{Object.entries(LEAD_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Responsável" hint="Em branco: segue a distribuição configurada."><Select {...bind('brokerId')}><option value="">Automático</option>{brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Observações" className="span-2"><textarea className="input textarea" style={{ minHeight: 80 }} {...bind('notes')} /></Field>
      </form>
    </Modal>
  );
}

export type { BoardCard };
