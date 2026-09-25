import { LEAD_STATUS_LABELS, PURPOSE_LABELS, TASK_TYPE_LABELS, type LeadStatus } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRightLeft, Check, CheckCircle2, Circle, ClipboardList, Mail, MessageCircle, Pencil, Phone, Plus, Sparkles, StickyNote, Trash2, UserCheck,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LostModal, StagePill, searchProperties, sourceLabel, useBrokers, usePipeline } from '../components/crm';
import { SearchPicker } from '../components/SearchPicker';
import { TaskModal, type TaskRow } from '../components/TaskModal';
import { Badge, Button, Field, Input, Modal, Select, SkeletonRows, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, dueLabel, formatPhone, timeAgo } from '../lib/format';
import { MoneyInput, brl } from '../lib/money';

interface Lead {
  id: string; source: string; status: LeadStatus; notes: string | null; createdAt: string; stageEnteredAt: string; lostReason: string | null; closedAt: string | null;
  budgetMin: number | null; budgetMax: number | null; purpose: keyof typeof PURPOSE_LABELS | null; city: string | null; neighborhood: string | null; bedrooms: number | null; purchaseTimeline: string | null;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  property: { id: string; code: string; title: string; status: string; purpose: string; salePrice: number | null; rentPrice: number | null; city: string | null; neighborhood: string | null } | null;
  broker: { id: string; name: string } | null;
  stage: { id: string; name: string; color: string; type: string } | null;
  attribution: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null; fbclid: string | null; gclid: string | null; landingPage: string | null; referrer: string | null } | null;
  timeline: { id: string; type: string; title: string; description: string | null; createdAt: string; userName: string | null }[];
  tasks: TaskRow[];
}

const STATUS_TONE: Record<LeadStatus, 'ok' | 'warn' | 'danger' | 'accent' | undefined> = { NEW: 'accent', CONTACTED: 'warn', QUALIFIED: 'warn', WON: 'ok', LOST: 'danger' };
const TL_ICON: Record<string, ReactNode> = {
  LEAD_CREATED: <Sparkles />, STAGE_CHANGED: <ArrowRightLeft />, LEAD_ASSIGNED: <UserCheck />, LEAD_UPDATED: <Pencil />, NOTE_ADDED: <StickyNote />, TASK_CREATED: <ClipboardList />, TASK_COMPLETED: <CheckCircle2 />,
};

export function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const pipeline = usePipeline();
  const brokers = useBrokers();
  const [note, setNote] = useState('');
  const [lost, setLost] = useState<string | null>(null);
  const [taskModal, setTaskModal] = useState<TaskRow | 'new' | null>(null);
  const [editing, setEditing] = useState(false);

  const q = useQuery({ queryKey: ['lead', id], queryFn: () => api<Lead>(`/leads/${id}`) });
  const refresh = () => { for (const k of ['lead', 'board', 'leads', 'tasks']) qc.invalidateQueries({ queryKey: [k] }); };
  const onError = (e: unknown) => toast.show(errorMessage(e));

  const stage = useMutation({
    mutationFn: (v: { stageId: string; lostReason?: string }) => api<Lead>(`/leads/${id}/change-stage`, { method: 'POST', body: v }),
    onSuccess: (l) => { qc.setQueryData(['lead', id], l); refresh(); setLost(null); toast.show('Lead movido.'); }, onError,
  });
  const assign = useMutation({
    mutationFn: (v: { brokerId?: string | null; auto?: boolean }) => api<Lead>(`/leads/${id}/assign`, { method: 'POST', body: v }),
    onSuccess: (l) => { qc.setQueryData(['lead', id], l); refresh(); toast.show('Responsável atualizado.'); }, onError,
  });
  const addNote = useMutation({
    mutationFn: () => api<Lead>(`/leads/${id}/notes`, { method: 'POST', body: { text: note } }),
    onSuccess: (l) => { qc.setQueryData(['lead', id], l); setNote(''); }, onError,
  });
  const complete = useMutation({ mutationFn: (tid: string) => api(`/tasks/${tid}/complete`, { method: 'POST' }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: () => api(`/leads/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); nav('/pipeline'); }, onError });

  if (q.isLoading) return <div className="card"><SkeletonRows rows={8} /></div>;
  if (q.error) return <div className="alert">{errorMessage(q.error)}</div>;
  const l = q.data!;
  const stages = pipeline.data?.stages ?? [];
  const phone = l.customer.phone;
  const price = l.property ? (l.property.purpose === 'RENT' ? l.property.rentPrice : l.property.salePrice) : null;

  return (
    <>
      <Link to="/pipeline" className="backlink"><ArrowLeft /> Pipeline</Link>
      <div className="lead-head">
        <div>
          <h1>{l.customer.name}</h1>
          <div className="lead-contact">
            {phone && <a href={`tel:+55${phone}`}><Phone size={14} style={{ verticalAlign: -2 }} /> {formatPhone(phone)}</a>}
            {l.customer.email && <a href={`mailto:${l.customer.email}`}><Mail size={14} style={{ verticalAlign: -2 }} /> {l.customer.email}</a>}
            <Badge tone={STATUS_TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge>
            <span className="card-sub">Criado {timeAgo(l.createdAt)}</span>
          </div>
        </div>
        <div className="toolbar-lead">
          {phone && <a className="btn" href={`https://wa.me/55${phone}`} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a>}
          <Select value={l.stage?.id ?? ''} disabled={!can('crm.pipeline') || stage.isPending} style={{ width: 200 }} aria-label="Etapa do funil"
            onChange={(e) => { const s = stages.find((x) => x.id === e.target.value); if (!s) return; s.type === 'LOST' ? setLost(s.id) : stage.mutate({ stageId: s.id }); }}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      </div>
      {l.status === 'LOST' && l.lostReason && <div className="alert" style={{ marginBottom: 16 }}><strong style={{ fontWeight: 600 }}>Lead perdido:</strong> {l.lostReason}</div>}

      <div className="lead-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head"><div className="card-title">Anotar</div></div>
            <form className="section-body" style={{ display: 'grid', gap: 10 }} onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
              <textarea className="input textarea" style={{ minHeight: 76 }} placeholder="Registre uma conversa, preferência do cliente ou próximo passo…" value={note} onChange={(e) => setNote(e.target.value)} disabled={!can('lead.edit')} maxLength={4000} />
              {can('lead.edit') && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="primary" disabled={!note.trim() || addNote.isPending}>Registrar anotação</Button></div>}
            </form>
          </section>

          <section className="card">
            <div className="card-head"><div className="card-title">Histórico</div><span className="card-sub">{l.timeline.length} {l.timeline.length === 1 ? 'registro' : 'registros'}</span></div>
            <div className="section-body">
              <ul className="tl">
                {l.timeline.map((t) => (
                  <li key={t.id}>
                    <span className={`tl-ico ${t.type === 'NOTE_ADDED' ? 'note' : ''}`}>{TL_ICON[t.type] ?? <Circle />}</span>
                    <div className="tl-body">
                      <div className="tl-title">{t.title}</div>
                      {t.description && <div className="tl-desc">{t.description}</div>}
                      <div className="tl-time" title={dateTime(t.createdAt)}>{t.userName ? `${t.userName} · ` : ''}{timeAgo(t.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-head"><div className="card-title">Responsável</div></div>
            <div className="section-body" style={{ display: 'grid', gap: 10 }}>
              {can('lead.assign') ? (
                <>
                  <Select value={l.broker?.id ?? ''} disabled={assign.isPending} onChange={(e) => assign.mutate({ brokerId: e.target.value || null })} aria-label="Responsável">
                    <option value="">Sem responsável</option>{brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                  <Button type="button" variant="ghost" onClick={() => assign.mutate({ auto: true })} disabled={assign.isPending}>Distribuir automaticamente</Button>
                </>
              ) : <span>{l.broker?.name ?? 'Sem responsável'}</span>}
              <div className="kvrow"><span>Etapa</span><span><StagePill stage={l.stage} /></span></div>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div className="card-title">Tarefas</div>{can('lead.edit') && <Button variant="ghost" onClick={() => setTaskModal('new')}><Plus /> Nova</Button>}</div>
            <div className="section-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
              {l.tasks.length === 0 ? <div className="card-sub" style={{ padding: '12px 0' }}>Nenhuma tarefa em aberto.</div> : l.tasks.map((t) => {
                const due = dueLabel(t.dueAt);
                return (
                  <div key={t.id} className="task">
                    <button className="task-check" aria-label="Concluir tarefa" disabled={!can('lead.edit')} onClick={() => complete.mutate(t.id)}><Check /></button>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="task-title" onClick={() => can('lead.edit') && setTaskModal(t)} style={{ cursor: 'pointer' }}>{t.title}</div>
                      <div className="task-meta"><span className={`due ${due.late ? 'late' : ''}`}>{due.text}</span><span>{TASK_TYPE_LABELS[t.type]}</span>{t.assignedUser && <span>{t.assignedUser.name}</span>}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div className="card-title">Interesse</div>{can('lead.edit') && <Button variant="ghost" onClick={() => setEditing(true)}><Pencil /> Editar</Button>}</div>
            <div className="section-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
              <div className="kvrow"><span>Imóvel</span><span>{l.property ? <Link to={`/imoveis/${l.property.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>{l.property.code} · {l.property.title}</Link> : '—'}</span></div>
              {l.property && <div className="kvrow"><span>Valor</span><span>{brl(price)}</span></div>}
              <div className="kvrow"><span>Finalidade</span><span>{l.purpose ? PURPOSE_LABELS[l.purpose] : '—'}</span></div>
              <div className="kvrow"><span>Região</span><span>{[l.neighborhood, l.city].filter(Boolean).join(', ') || '—'}</span></div>
              <div className="kvrow"><span>Dormitórios</span><span>{l.bedrooms ?? '—'}</span></div>
              <div className="kvrow"><span>Orçamento</span><span>{l.budgetMin || l.budgetMax ? `${l.budgetMin ? brl(l.budgetMin) : '…'} a ${l.budgetMax ? brl(l.budgetMax) : '…'}` : '—'}</span></div>
              <div className="kvrow"><span>Prazo de compra</span><span>{l.purchaseTimeline ?? '—'}</span></div>
              {l.notes && <div className="kvrow" style={{ display: 'block' }}><span style={{ display: 'block', marginBottom: 4 }}>Mensagem</span><span style={{ textAlign: 'left', display: 'block', color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{l.notes}</span></div>}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><div className="card-title">Origem</div></div>
            <div className="section-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
              <div className="kvrow"><span>Canal</span><span>{sourceLabel(l.source)}</span></div>
              {l.attribution ? (
                <>
                  {l.attribution.utmSource && <div className="kvrow"><span>Fonte</span><span>{l.attribution.utmSource}{l.attribution.utmMedium ? ` / ${l.attribution.utmMedium}` : ''}</span></div>}
                  {l.attribution.utmCampaign && <div className="kvrow"><span>Campanha</span><span>{l.attribution.utmCampaign}</span></div>}
                  {l.attribution.utmContent && <div className="kvrow"><span>Anúncio</span><span>{l.attribution.utmContent}</span></div>}
                  {(l.attribution.fbclid || l.attribution.gclid) && <div className="kvrow"><span>Clique</span><span>{l.attribution.fbclid ? 'Meta Ads' : 'Google Ads'}</span></div>}
                  {l.attribution.referrer && <div className="kvrow"><span>Veio de</span><span>{l.attribution.referrer.replace(/^https?:\/\//, '').slice(0, 40)}</span></div>}
                </>
              ) : <div className="card-sub" style={{ padding: '8px 0' }}>Sem dados de campanha.</div>}
            </div>
          </section>

          {can('lead.delete') && <Button variant="danger" onClick={() => confirm('Excluir este lead e todo o seu histórico? Esta ação não pode ser desfeita.') && remove.mutate()}><Trash2 /> Excluir lead</Button>}
        </aside>
      </div>

      {lost && <LostModal busy={stage.isPending} onClose={() => setLost(null)} onConfirm={(reason) => stage.mutate({ stageId: lost, lostReason: reason })} />}
      {taskModal && <TaskModal task={taskModal === 'new' ? null : taskModal} leadId={l.id} onClose={() => setTaskModal(null)} onSaved={() => setTaskModal(null)} />}
      {editing && <EditInterest lead={l} onClose={() => setEditing(false)} onSaved={(nl) => { qc.setQueryData(['lead', id], nl); refresh(); setEditing(false); toast.show('Dados atualizados.'); }} />}
      {toast.node}
    </>
  );
}

function EditInterest({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: (l: Lead) => void }) {
  const [f, setF] = useState({
    purpose: lead.purpose ?? '', city: lead.city ?? '', neighborhood: lead.neighborhood ?? '', bedrooms: lead.bedrooms?.toString() ?? '',
    purchaseTimeline: lead.purchaseTimeline ?? '', notes: lead.notes ?? '', budgetMin: lead.budgetMin, budgetMax: lead.budgetMax,
  });
  const [property, setProperty] = useState<{ id: string; label: string; sub?: string } | null>(lead.property ? { id: lead.property.id, label: `${lead.property.code} · ${lead.property.title}` } : null);
  const [err, setErr] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: () => api<Lead>(`/leads/${lead.id}`, {
      method: 'PATCH',
      body: {
        propertyId: property?.id ?? null, purpose: f.purpose || null, city: f.city || null, neighborhood: f.neighborhood || null,
        bedrooms: f.bedrooms === '' ? null : Number(f.bedrooms), purchaseTimeline: f.purchaseTimeline || null, notes: f.notes || null,
        budgetMin: f.budgetMin, budgetMax: f.budgetMax,
      },
    }),
    onSuccess: onSaved, onError: setErr,
  });
  return (
    <Modal title="Interesse do lead" onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" form="interest-form" disabled={save.isPending}>Salvar</Button></>}>
      <form id="interest-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        {err != null && <div className="alert span-2">{errorMessage(err)}</div>}
        <div className="span-2 field"><label>Imóvel de interesse</label><SearchPicker queryKey="pick-property" value={property} onChange={setProperty} search={searchProperties} placeholder="Buscar por código, título ou bairro…" /></div>
        <Field label="Finalidade"><Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}><option value="">—</option>{Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Dormitórios"><Input type="number" min={0} value={f.bedrooms} onChange={(e) => setF({ ...f, bedrooms: e.target.value })} /></Field>
        <Field label="Cidade"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="Bairro"><Input value={f.neighborhood} onChange={(e) => setF({ ...f, neighborhood: e.target.value })} /></Field>
        <Field label="Orçamento mínimo"><MoneyInput value={f.budgetMin} onChange={(v) => setF({ ...f, budgetMin: v })} /></Field>
        <Field label="Orçamento máximo"><MoneyInput value={f.budgetMax} onChange={(v) => setF({ ...f, budgetMax: v })} /></Field>
        <Field label="Prazo para comprar" className="span-2"><Input value={f.purchaseTimeline} onChange={(e) => setF({ ...f, purchaseTimeline: e.target.value })} placeholder="Ex.: até 3 meses" /></Field>
        <Field label="Observações" className="span-2"><textarea className="input textarea" style={{ minHeight: 80 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
