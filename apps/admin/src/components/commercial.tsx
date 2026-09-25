import {
  PARTY_LABELS, PROPOSAL_STATUS_LABELS, VISIT_STATUS_LABELS, type ProposalParty, type ProposalStatus, type VisitStatus,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Clock, MapPin, UserX, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, formatPhone, toLocalInput } from '../lib/format';
import { MoneyInput, brl } from '../lib/money';
import { SearchPicker } from './SearchPicker';
import { searchLeads, searchProperties, useBrokers } from './crm';
import { Badge, Button, Field, Input, Modal, Select, errorMessage, fieldErrors } from './ui';

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | undefined;
type Picked = { id: string; label: string; sub?: string } | null;

export interface VisitRow {
  id: string; leadId: string; propertyId: string; brokerId: string; status: VisitStatus; scheduledAt: string; durationMinutes: number;
  notes: string | null; feedback: string | null; cancelReason: string | null;
  lead: { id: string; customer: { id: string; name: string; phone: string | null } };
  property: { id: string; code: string; title: string; neighborhood: string | null; city: string | null };
  broker: { id: string; name: string };
}

export interface ProposalRow {
  id: string; leadId: string; propertyId: string; status: ProposalStatus; conditions: string | null; validUntil: string | null; decidedAt: string | null;
  createdAt: string; updatedAt: string; askingPrice: number; proposedPrice: number; downPayment: number | null; financingAmount: number | null; differencePct: number;
  lead: { id: string; customer: { id: string; name: string; phone: string | null } };
  property: { id: string; code: string; title: string; purpose: string; status: string; city: string | null; neighborhood: string | null };
  owner?: { id: string; name: string; phone: string | null; whatsapp: string | null } | null;
  minimumNegotiationPrice?: number | null; belowMinimum?: boolean;
  revisions: { id: string; amount: number; conditions: string | null; party: ProposalParty; note: string | null; createdAt: string; createdBy: string | null }[];
}

export const VISIT_TONE: Record<VisitStatus, Tone> = { SCHEDULED: 'accent', CONFIRMED: 'ok', COMPLETED: 'ok', CANCELLED: undefined, NO_SHOW: 'danger' };
export const PROPOSAL_TONE: Record<ProposalStatus, Tone> = { DRAFT: undefined, SENT: 'accent', UNDER_REVIEW: 'warn', COUNTERED: 'warn', ACCEPTED: 'ok', REJECTED: 'danger', EXPIRED: undefined, CANCELLED: undefined };

export const pct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`;
export const timeRange = (v: { scheduledAt: string; durationMinutes: number }) => {
  const s = new Date(v.scheduledAt);
  const e = new Date(s.getTime() + v.durationMinutes * 60_000);
  const hm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${hm(s)} – ${hm(e)}`;
};
const refreshAll = (qc: ReturnType<typeof useQueryClient>) => { for (const k of ['visits', 'proposals', 'lead', 'board', 'leads', 'tasks', 'commercial']) qc.invalidateQueries({ queryKey: [k] }); };

// ---------- Visita: agendar / remarcar ----------
export function VisitModal({ visit, leadId, property, onClose, onSaved }: {
  visit?: VisitRow | null; leadId?: string; property?: Picked; onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const brokers = useBrokers();
  const { user, can } = useAuth();
  const [lead, setLead] = useState<Picked>(visit ? { id: visit.lead.id, label: visit.lead.customer.name } : null);
  const [prop, setProp] = useState<Picked>(visit ? { id: visit.property.id, label: `${visit.property.code} · ${visit.property.title}` } : (property ?? null));
  const [f, setF] = useState({
    scheduledAt: toLocalInput(visit?.scheduledAt), durationMinutes: String(visit?.durationMinutes ?? 60), brokerId: visit?.brokerId ?? (can('lead.view_all') ? '' : user?.id ?? ''), notes: visit?.notes ?? '',
  });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const clash = err instanceof ApiError && err.code === 'VISIT_CONFLICT' ? (err.details as { id: string; scheduledAt: string; durationMinutes: number; customer: string; propertyCode: string }[]) : null;

  const save = useMutation({
    mutationFn: (force?: boolean) => {
      const body = {
        scheduledAt: new Date(f.scheduledAt).toISOString(), durationMinutes: Number(f.durationMinutes), notes: f.notes || null,
        ...(f.brokerId && { brokerId: f.brokerId }), ...(prop && { propertyId: prop.id }), ...(force && { force: true }),
      };
      return visit ? api(`/visits/${visit.id}`, { method: 'PATCH', body }) : api('/visits', { method: 'POST', body: { ...body, leadId: leadId ?? lead?.id } });
    },
    onSuccess: () => { refreshAll(qc); onSaved(); },
    onError: setErr,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); e.stopPropagation(); setErr(null); save.mutate(false); };
  const missing = !f.scheduledAt || (!visit && !leadId && !lead);

  return (
    <Modal title={visit ? 'Remarcar visita' : 'Agendar visita'} onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" form="visit-form" disabled={save.isPending || missing}>{save.isPending ? 'Salvando…' : visit ? 'Salvar' : 'Agendar'}</Button></>}>
      <form id="visit-form" className="form-grid" onSubmit={submit}>
        {err != null && !Object.keys(fe).length && (
          <div className="alert span-2">
            {errorMessage(err)}
            {clash && (
              <>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{clash.map((c) => <li key={c.id}>{dateTime(c.scheduledAt)} · {c.customer} · {c.propertyCode}</li>)}</ul>
                <Button type="button" style={{ marginTop: 10 }} onClick={() => { setErr(null); save.mutate(true); }}>Agendar mesmo assim</Button>
              </>
            )}
          </div>
        )}
        {!visit && !leadId && <div className="span-2 field"><label>Lead</label><SearchPicker queryKey="pick-lead" value={lead} onChange={setLead} search={searchLeads} placeholder="Buscar pelo nome do cliente…" /></div>}
        <div className="span-2 field"><label>Imóvel</label><SearchPicker queryKey="pick-property" value={prop} onChange={setProp} search={searchProperties} placeholder={visit || leadId ? 'Imóvel de interesse do lead' : 'Buscar por código, título ou bairro…'} /></div>
        <Field label="Data e hora" error={fe.scheduledAt}><Input type="datetime-local" required value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
        <Field label="Duração"><Select value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}</Select></Field>
        <Field label="Corretor" className="span-2">
          <Select value={f.brokerId} disabled={!can('lead.view_all')} onChange={(e) => setF({ ...f, brokerId: e.target.value })}>
            <option value="">Responsável pelo lead</option>{brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Observações" className="span-2"><textarea className="input textarea" style={{ minHeight: 70 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Como chegar, quem recebe, pedidos do cliente…" /></Field>
      </form>
    </Modal>
  );
}

// ---------- Visita: cartão com ações ----------
export function VisitCard({ v, showLead = true, onEdit }: { v: VisitRow; showLead?: boolean; onEdit: (v: VisitRow) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [ask, setAsk] = useState<null | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (body: object) => api(`/visits/${v.id}`, { method: 'PATCH', body }),
    onSuccess: () => { refreshAll(qc); setAsk(null); setText(''); setError(null); },
    onError: (e) => { setError(errorMessage(e)); setAsk(null); },
  });
  const active = v.status === 'SCHEDULED' || v.status === 'CONFIRMED';
  const edit = can('visit.edit');
  const past = new Date(v.scheduledAt).getTime() <= Date.now() + 30 * 60_000;

  return (
    <div className={`visit ${v.status === 'CANCELLED' || v.status === 'NO_SHOW' ? 'off' : ''}`}>
      <div className="visit-time"><strong>{new Date(v.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong><span>{v.durationMinutes} min</span></div>
      <div className="visit-main">
        <div className="visit-title">
          {showLead ? <Link to={`/leads/${v.lead.id}`}>{v.lead.customer.name}</Link> : <span>{dateTime(v.scheduledAt)}</span>}
          <Badge tone={VISIT_TONE[v.status]}>{VISIT_STATUS_LABELS[v.status]}</Badge>
        </div>
        <div className="card-sub"><MapPin size={12} style={{ verticalAlign: -1 }} /> {v.property.code} · {v.property.title}{v.property.neighborhood ? ` · ${v.property.neighborhood}` : ''}</div>
        <div className="card-sub">Corretor: {v.broker.name}{v.lead.customer.phone ? ` · ${formatPhone(v.lead.customer.phone)}` : ''}</div>
        {v.notes && <div className="visit-note">{v.notes}</div>}
        {v.feedback && <div className="visit-note"><strong>Retorno do cliente:</strong> {v.feedback}</div>}
        {v.cancelReason && <div className="visit-note"><strong>Motivo:</strong> {v.cancelReason}</div>}
        {error && <div className="alert" style={{ marginTop: 8 }}>{error}</div>}
        {ask && (
          <form className="visit-ask" onSubmit={(e) => { e.preventDefault(); change.mutate({ status: ask, ...(ask === 'COMPLETED' ? { feedback: text || null } : { cancelReason: text || null }) }); }}>
            <textarea className="input textarea" style={{ minHeight: 60 }} autoFocus value={text} onChange={(e) => setText(e.target.value)}
              placeholder={ask === 'COMPLETED' ? 'Como foi a visita? O que o cliente achou?' : ask === 'NO_SHOW' ? 'Observação (opcional)' : 'Motivo do cancelamento (opcional)'} />
            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" onClick={() => { setAsk(null); setText(''); }}>Voltar</Button>
              <Button variant={ask === 'COMPLETED' ? 'primary' : 'danger'} disabled={change.isPending}>{ask === 'COMPLETED' ? 'Registrar visita realizada' : ask === 'NO_SHOW' ? 'Cliente não compareceu' : 'Cancelar visita'}</Button>
            </div>
          </form>
        )}
      </div>
      {edit && !ask && (
        <div className="visit-actions">
          {v.status === 'SCHEDULED' && <Button variant="ghost" title="Confirmar com o cliente" onClick={() => change.mutate({ status: 'CONFIRMED' })}><Check /> Confirmar</Button>}
          {active && past && <Button variant="ghost" onClick={() => setAsk('COMPLETED')}><CheckCheck /> Realizada</Button>}
          {active && past && <Button variant="ghost" onClick={() => setAsk('NO_SHOW')}><UserX /> Faltou</Button>}
          {active && <Button variant="ghost" onClick={() => onEdit(v)}><Clock /> Remarcar</Button>}
          {active && <Button variant="ghost" className="btn-danger" onClick={() => setAsk('CANCELLED')}><X /> Cancelar</Button>}
          {v.status === 'COMPLETED' && !v.feedback && <Button variant="ghost" onClick={() => setAsk('COMPLETED')}>Registrar retorno</Button>}
        </div>
      )}
    </div>
  );
}

// ---------- Proposta: nova ----------
export function ProposalModal({ leadId, property, onClose, onSaved }: { leadId?: string; property?: Picked; onClose: () => void; onSaved: (p: ProposalRow) => void }) {
  const qc = useQueryClient();
  const [lead, setLead] = useState<Picked>(null);
  const [prop, setProp] = useState<Picked>(property ?? null);
  const [f, setF] = useState<{ price: number | null; down: number | null; fin: number | null; validUntil: string; conditions: string }>({ price: null, down: null, fin: null, validUntil: '', conditions: '' });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const save = useMutation({
    mutationFn: (send: boolean) => api<ProposalRow>('/proposals', {
      method: 'POST',
      body: {
        leadId: leadId ?? lead?.id, ...(prop && { propertyId: prop.id }), proposedPrice: f.price, downPayment: f.down, financingAmount: f.fin,
        conditions: f.conditions || null, validUntil: f.validUntil ? new Date(`${f.validUntil}T23:59:59`).toISOString() : null, send,
      },
    }),
    onSuccess: (p) => { refreshAll(qc); onSaved(p); },
    onError: setErr,
  });
  const ready = !!f.price && (!!leadId || !!lead);
  return (
    <Modal title="Nova proposta" onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button>
        <Button type="button" disabled={!ready || save.isPending} onClick={() => { setErr(null); save.mutate(false); }}>Salvar rascunho</Button>
        <Button variant="primary" disabled={!ready || save.isPending} onClick={() => { setErr(null); save.mutate(true); }}>{save.isPending ? 'Salvando…' : 'Registrar envio'}</Button></>}>
      <div className="form-grid">
        {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
        {!leadId && <div className="span-2 field"><label>Lead (comprador)</label><SearchPicker queryKey="pick-lead" value={lead} onChange={setLead} search={searchLeads} placeholder="Buscar pelo nome do cliente…" /></div>}
        <div className="span-2 field"><label>Imóvel</label><SearchPicker queryKey="pick-property" value={prop} onChange={setProp} search={searchProperties} placeholder="Deixe em branco para usar o imóvel de interesse do lead" /></div>
        <Field label="Valor da proposta" error={fe.proposedPrice} className="span-2"><MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
        <Field label="Entrada" error={fe.downPayment}><MoneyInput value={f.down} onChange={(v) => setF({ ...f, down: v })} /></Field>
        <Field label="Financiamento" error={fe.financingAmount}><MoneyInput value={f.fin} onChange={(v) => setF({ ...f, fin: v })} /></Field>
        <Field label="Válida até" hint="Depois desta data a proposta expira sozinha." className="span-2"><Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></Field>
        <Field label="Condições" className="span-2"><textarea className="input textarea" style={{ minHeight: 80 }} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} placeholder="Forma de pagamento, prazo de escritura, itens que ficam no imóvel…" /></Field>
      </div>
    </Modal>
  );
}

// ---------- Proposta: negociação ----------
export function ProposalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['proposals', 'one', id], queryFn: () => api<ProposalRow>(`/proposals/${id}`) });
  const [counter, setCounter] = useState<{ party: ProposalParty; amount: number | null; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (p: ProposalRow) => { qc.setQueryData(['proposals', 'one', id], p); refreshAll(qc); setCounter(null); setError(null); };
  const patch = useMutation({ mutationFn: (status: ProposalStatus) => api<ProposalRow>(`/proposals/${id}`, { method: 'PATCH', body: { status } }), onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  const cnt = useMutation({ mutationFn: () => api<ProposalRow>(`/proposals/${id}/counter`, { method: 'POST', body: { amount: counter!.amount, party: counter!.party, note: counter!.note || null } }), onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  const close = useMutation({ mutationFn: () => api<ProposalRow>(`/proposals/${id}/close`, { method: 'POST' }), onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  const p = q.data;
  const manage = can('proposal.manage');
  const edit = can('proposal.create');
  const negotiable = !!p && ['SENT', 'UNDER_REVIEW', 'COUNTERED'].includes(p.status);

  return (
    <Modal title="Proposta" onClose={onClose}>
      {!p ? <div className="skeleton" style={{ height: 120 }} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div><Link to={`/leads/${p.lead.id}`} onClick={onClose} style={{ fontWeight: 600, color: 'var(--accent)' }}>{p.lead.customer.name}</Link>
                <div className="card-sub">{p.property.code} · {p.property.title}</div></div>
              <Badge tone={PROPOSAL_TONE[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
            </div>
          </div>
          <div className="prop-values">
            <div><span>Pedido</span><strong>{brl(p.askingPrice)}</strong></div>
            <div><span>Proposta atual</span><strong>{brl(p.proposedPrice)}</strong><small className={p.differencePct < 0 ? 'neg' : ''}>{pct(p.differencePct)} do pedido</small></div>
            {p.minimumNegotiationPrice != null && <div><span>Mínimo do proprietário</span><strong>{brl(p.minimumNegotiationPrice)}</strong>{p.belowMinimum && <small className="neg">abaixo do mínimo</small>}</div>}
          </div>
          <div>
            {p.downPayment != null && <div className="kvrow"><span>Entrada</span><span>{brl(p.downPayment)}</span></div>}
            {p.financingAmount != null && <div className="kvrow"><span>Financiamento</span><span>{brl(p.financingAmount)}</span></div>}
            <div className="kvrow"><span>Válida até</span><span>{p.validUntil ? new Date(p.validUntil).toLocaleDateString('pt-BR') : 'Sem prazo'}</span></div>
            {p.owner && <div className="kvrow"><span>Proprietário</span><span>{p.owner.name}{p.owner.whatsapp || p.owner.phone ? ` · ${p.owner.whatsapp ?? p.owner.phone}` : ''}</span></div>}
            {p.conditions && <div className="kvrow" style={{ display: 'block' }}><span style={{ display: 'block', marginBottom: 4 }}>Condições</span><span style={{ display: 'block', textAlign: 'left', whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{p.conditions}</span></div>}
          </div>

          <div>
            <div className="chip-label">Negociação</div>
            <ul className="rev">
              {[...p.revisions].reverse().map((r) => (
                <li key={r.id}>
                  <span className={`rev-dot ${r.party === 'OWNER' ? 'owner' : ''}`} />
                  <div><strong>{brl(r.amount)}</strong> <span className="card-sub">· {PARTY_LABELS[r.party]}{r.createdBy ? ` · registrado por ${r.createdBy}` : ''}</span>
                    {r.note && <div className="card-sub">{r.note}</div>}
                    <div className="card-sub">{dateTime(r.createdAt)}</div></div>
                </li>
              ))}
            </ul>
          </div>

          {error && <div className="alert">{error}</div>}
          {counter && (
            <form className="visit-ask" onSubmit={(e) => { e.preventDefault(); cnt.mutate(); }}>
              <div className="chip-label">{counter.party === 'OWNER' ? 'Contraproposta do proprietário' : 'Nova oferta do comprador'}</div>
              <MoneyInput value={counter.amount} onChange={(v) => setCounter({ ...counter, amount: v })} />
              <Input placeholder="Observação (opcional)" value={counter.note} onChange={(e) => setCounter({ ...counter, note: e.target.value })} />
              <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                <Button type="button" variant="ghost" onClick={() => setCounter(null)}>Voltar</Button>
                <Button variant="primary" disabled={!counter.amount || cnt.isPending}>Registrar</Button>
              </div>
            </form>
          )}
          {!counter && (
            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
              {edit && p.status === 'DRAFT' && <Button variant="primary" onClick={() => patch.mutate('SENT')}>Registrar envio ao proprietário</Button>}
              {edit && negotiable && <Button onClick={() => setCounter({ party: 'OWNER', amount: null, note: '' })}>Contraproposta do proprietário</Button>}
              {edit && negotiable && <Button onClick={() => setCounter({ party: 'BUYER', amount: null, note: '' })}>Nova oferta do comprador</Button>}
              {manage && negotiable && <Button variant="primary" onClick={() => confirm('Aceitar esta proposta? O imóvel ficará reservado.') && patch.mutate('ACCEPTED')}>Aceitar</Button>}
              {manage && negotiable && <Button variant="danger" onClick={() => confirm('Marcar como recusada?') && patch.mutate('REJECTED')}>Recusar</Button>}
              {manage && p.status === 'ACCEPTED' && <Button variant="primary" onClick={() => confirm(`Fechar o negócio por ${brl(p.proposedPrice)}? O imóvel será marcado como ${p.property.purpose === 'RENT' ? 'alugado' : 'vendido'} e o lead como ganho.`) && close.mutate()}>Fechar negócio</Button>}
              {((edit && ['DRAFT', 'SENT', 'UNDER_REVIEW', 'COUNTERED'].includes(p.status)) || (manage && p.status === 'ACCEPTED')) && (
                <Button variant="ghost" className="btn-danger" onClick={() => confirm('Cancelar esta proposta?') && patch.mutate('CANCELLED')}>Cancelar proposta</Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
