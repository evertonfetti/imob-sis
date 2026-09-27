import type { BillingMode, InvoiceStatus, LicenseCreatedDto, LicenseDetailDto, LicenseStatus, PlanDto, UsageCounts } from '@imob/types';
import { BILLING_MODE_LABELS, INVOICE_STATUS_LABELS, LICENSE_STATUSES, LICENSE_STATUS_LABELS, PLAN_LIMIT_LABELS } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, KeyRound, Receipt, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Field, Modal, Select, SkeletonRows, errorMessage } from '../components/ui';
import { api } from '../lib/api';

const statusTone = (s: string) => (s === 'ACTIVE' || s === 'TRIALING' ? 'ok' : s === 'PAST_DUE' ? 'warn' : 'danger') as 'ok' | 'warn' | 'danger';
const invoiceTone = (s: InvoiceStatus) => (s === 'PAID' ? 'ok' : s === 'PENDING' ? 'warn' : 'danger') as 'ok' | 'warn' | 'danger';
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
const dateOnly = (v: string) => new Date(v).toLocaleDateString('pt-BR');
const COUNT_LABELS: Record<keyof UsageCounts, string> = {
  users: 'usuários', properties: 'imóveis', branches: 'filiais', socialAccounts: 'contas de redes sociais', aiAccounts: 'contas de IA', whatsappSendsMonth: 'envios de WhatsApp no mês',
};
const countsLine = (c: UsageCounts) => Object.entries(c).filter(([, v]) => v != null).map(([k, v]) => `${v} ${COUNT_LABELS[k as keyof UsageCounts] ?? k}`).join(' · ') || '—';

export function LicenseDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [statusOpen, setStatusOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [newKey, setNewKey] = useState<LicenseCreatedDto | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const lic = useQuery({ queryKey: ['license', id], queryFn: () => api<LicenseDetailDto>(`/licenses/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['license', id] });

  const regenerate = useMutation({
    mutationFn: () => api<LicenseCreatedDto>(`/licenses/${id}/regenerate-key`, { method: 'POST' }),
    onSuccess: (l) => { setNewKey(l); refresh(); }, onError: setErr,
  });
  const resetFingerprint = useMutation({
    mutationFn: () => api(`/licenses/${id}/reset-fingerprint`, { method: 'POST' }),
    onSuccess: refresh, onError: setErr,
  });
  const createInvoice = useMutation({
    mutationFn: () => api(`/licenses/${id}/invoices`, { method: 'POST' }),
    onSuccess: refresh, onError: setErr,
  });
  const toggleBilling = useMutation({
    mutationFn: (billingMode: BillingMode) => api(`/licenses/${id}/billing-mode`, { method: 'PATCH', body: { billingMode } }),
    onSuccess: refresh, onError: setErr,
  });

  if (lic.isLoading) return <SkeletonRows rows={8} />;
  if (lic.error) return <div className="alert">{errorMessage(lic.error)}</div>;
  const l = lic.data!;

  return (
    <>
      <Link to={`/clientes/${l.clientId}`} className="btn btn-ghost" style={{ marginBottom: 16 }}><ArrowLeft size={16} /> {l.clientName}</Link>
      <div className="page-head">
        <div><h1 className="page-title">{l.planName}</h1><p className="page-sub">Criada em {dt(l.createdAt)}</p></div>
        <Badge tone={statusTone(l.status)}>{LICENSE_STATUS_LABELS[l.status]}</Badge>
      </div>
      {err != null && <div className="alert" style={{ marginBottom: 16 }}>{errorMessage(err)}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><div className="card-title">Instalação</div></div>
        <div className="card-pad" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div><div className="label">Chave</div><div>•••• {l.keyPreview}</div></div>
          <div><div className="label">Última confirmação</div><div>{dt(l.lastSeenAt)}</div></div>
          <div><div className="label">Vínculo (impressão da instalação)</div><div className="card-sub" style={{ wordBreak: 'break-all' }}>{l.instanceFingerprint ?? 'Ainda não confirmou'}</div></div>
          <div><div className="label">Versão / endereço</div><div className="card-sub">{l.instanceVersion ?? '—'} · {l.instanceUrl ?? '—'}</div></div>
          <div><div className="label">Fim do teste</div><div>{dt(l.trialEndsAt)}</div></div>
          <div><div className="label">Fim do período atual</div><div>{dt(l.currentPeriodEnd)}</div></div>
          {l.suspendReason && <div className="span-2"><div className="label">Motivo</div><div>{l.suspendReason}</div></div>}
        </div>
        <div className="card-pad" style={{ paddingTop: 0, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button onClick={() => setStatusOpen(true)}>Mudar status</Button>
          <Button onClick={() => setPlanOpen(true)}>Trocar plano</Button>
          <Button disabled={regenerate.isPending} onClick={() => { if (confirm('Gerar uma nova chave? A chave atual para de funcionar imediatamente.')) regenerate.mutate(); }}><KeyRound size={16} /> Gerar nova chave</Button>
          <Button disabled={resetFingerprint.isPending} onClick={() => { if (confirm('Liberar o vínculo? A próxima instalação a confirmar com esta chave assume o lugar da atual.')) resetFingerprint.mutate(); }}><Unlink size={16} /> Liberar vínculo</Button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div><div className="card-title">Cobrança</div><div className="card-sub">{BILLING_MODE_LABELS[l.billingMode]}</div></div>
          <Badge {...(l.billingMode === 'AUTO' ? { tone: 'accent' as const } : {})}>{l.billingMode === 'AUTO' ? 'Automática' : 'Manual'}</Badge>
        </div>
        {!l.billingEnabled ? (
          <div className="card-pad card-sub">O Mercado Pago ainda não foi configurado neste servidor (variável <code>MP_ACCESS_TOKEN</code>). Até lá, controle o status manualmente acima.</div>
        ) : (
          <div className="card-pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button disabled={createInvoice.isPending} onClick={() => createInvoice.mutate()}><Receipt size={16} /> Gerar cobrança agora</Button>
            <Button disabled={toggleBilling.isPending} onClick={() => toggleBilling.mutate(l.billingMode === 'AUTO' ? 'MANUAL' : 'AUTO')}>
              {l.billingMode === 'AUTO' ? 'Passar para manual' : 'Voltar para automática'}
            </Button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><div className="card-title">Faturas</div></div>
        {l.invoices.length === 0 ? <div className="card-pad card-sub">Nenhuma fatura ainda.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Período</th><th>Valor</th><th>Status</th><th>Vencimento</th><th></th></tr></thead>
              <tbody>
                {l.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="card-sub">{dateOnly(inv.periodStart)} – {dateOnly(inv.periodEnd)}</td>
                    <td>{brl(inv.amountCents)}</td>
                    <td><Badge tone={invoiceTone(inv.status)}>{INVOICE_STATUS_LABELS[inv.status]}</Badge></td>
                    <td className="card-sub">{inv.paidAt ? `Paga em ${dt(inv.paidAt)}` : dateOnly(inv.dueAt)}</td>
                    <td className="actions">
                      {inv.status === 'PENDING' && inv.checkoutUrl && (
                        <a className="btn" href={inv.checkoutUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Link de pagamento</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><div className="card-title">Uso reportado</div></div>
        {l.usage.length === 0 ? <div className="card-pad card-sub">Nenhuma confirmação ainda.</div> : (
          <ul className="timeline">
            {l.usage.map((u, i) => <li key={i}><div className="timeline-dot" /><div className="timeline-text">{countsLine(u.counts)}</div><div className="timeline-time">{dt(u.reportedAt)}</div></li>)}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Linha do tempo</div></div>
        {l.events.length === 0 ? <div className="card-pad card-sub">Nada registrado ainda.</div> : (
          <ul className="timeline">
            {l.events.map((e) => <li key={e.id}><div className="timeline-dot" /><div className="timeline-text">{e.message}{e.staffName && <span className="card-sub"> · {e.staffName}</span>}</div><div className="timeline-time">{dt(e.createdAt)}</div></li>)}
          </ul>
        )}
      </div>

      {statusOpen && <StatusModal current={l.status} onClose={() => setStatusOpen(false)} onSave={async (status, reason) => { await api(`/licenses/${id}/status`, { method: 'PATCH', body: { status, reason } }); refresh(); setStatusOpen(false); }} />}
      {planOpen && <PlanChangeModal currentPlanId={l.planId} onClose={() => setPlanOpen(false)} onSave={async (planId) => { await api(`/licenses/${id}/plan`, { method: 'PATCH', body: { planId } }); refresh(); setPlanOpen(false); }} />}
      {newKey && (
        <Modal title="Nova chave gerada" onClose={() => setNewKey(null)} footer={<Button variant="primary" onClick={() => setNewKey(null)}>Concluído</Button>}>
          <p className="card-sub" style={{ marginBottom: 12 }}>A chave anterior parou de funcionar. Atualize <code>LICENSE_KEY</code> na instalação do cliente com o valor abaixo.</p>
          <div className="key-reveal">{newKey.key}</div>
        </Modal>
      )}
    </>
  );
}

function StatusModal({ current, onClose, onSave }: { current: LicenseStatus; onClose: () => void; onSave: (status: LicenseStatus, reason: string) => Promise<void> }) {
  const [status, setStatus] = useState(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title="Mudar status da licença" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(status, reason); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Salvar</Button></>}>
      {err != null && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
      <div className="form-grid">
        <Field label="Status" className="span-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value as LicenseStatus)}>
            {LICENSE_STATUSES.map((s) => <option key={s} value={s}>{LICENSE_STATUS_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Motivo (opcional)" className="span-2" hint="Aparece para você na linha do tempo; se suspender, também é mostrado ao cliente.">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: inadimplência, a pedido do cliente…" />
        </Field>
      </div>
    </Modal>
  );
}

function PlanChangeModal({ currentPlanId, onClose, onSave }: { currentPlanId: string; onClose: () => void; onSave: (planId: string) => Promise<void> }) {
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanDto[]>('/plans') });
  const [planId, setPlanId] = useState(currentPlanId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const active = plans.data?.filter((p) => p.active || p.id === currentPlanId) ?? [];
  return (
    <Modal title="Trocar plano" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(planId); } catch (e) { setErr(e); } finally { setBusy(false); } }}>Salvar</Button></>}>
      {err != null && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
      <Field label="Plano">
        <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {active.map((p) => <option key={p.id} value={p.id}>{p.name} — {Object.entries(PLAN_LIMIT_LABELS).filter(([k]) => p.limits[k as keyof typeof p.limits] != null).length} limites</option>)}
        </Select>
      </Field>
    </Modal>
  );
}
