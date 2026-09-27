import type { PlanDto, PlanInput, PlanLimits } from '@imob/types';
import { BILLING_INTERVAL_LABELS, PLAN_LIMIT_LABELS } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, SkeletonRows, errorMessage, fieldErrors } from '../components/ui';
import { api } from '../lib/api';

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const LIMIT_KEYS = Object.keys(PLAN_LIMIT_LABELS) as (keyof PlanLimits)[];

function limitsSummary(l: PlanLimits) {
  const parts = LIMIT_KEYS.filter((k) => k !== 'aiAgent' && l[k] != null).map((k) => `${l[k]} ${PLAN_LIMIT_LABELS[k].toLowerCase()}`);
  if (l.aiAgent) parts.push('agente de IA');
  return parts.length ? parts.join(' · ') : 'Sem limites definidos';
}

const EMPTY: PlanInput = { key: '', name: '', priceCents: 0, billingInterval: 'MONTHLY', limits: {}, active: true };

export function Plans() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PlanDto | 'new' | null>(null);
  const list = useQuery({ queryKey: ['plans'], queryFn: () => api<PlanDto[]>('/plans') });

  return (
    <>
      <PageHeader title="Planos" subtitle="O que cada plano libera: limites e preço." actions={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> Novo plano</Button>} />
      <div className="card">
        {list.isLoading ? <SkeletonRows /> : !list.data?.length ? (
          <Empty icon={<ScrollText />} title="Nenhum plano cadastrado" hint="Crie o primeiro plano para poder licenciar um cliente." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plano</th><th>Preço</th><th>Limites</th><th>Licenças</th><th></th></tr></thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id} className="row-link" onClick={() => setEditing(p)}>
                    <td><strong>{p.name}</strong> {!p.active && <Badge tone="warn" plain>inativo</Badge>}<div className="card-sub">{p.key} · {BILLING_INTERVAL_LABELS[p.billingInterval]}</div></td>
                    <td>{brl(p.priceCents)}</td>
                    <td className="card-sub">{limitsSummary(p.limits)}</td>
                    <td>{p.licenseCount}</td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <PlanModal plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { qc.invalidateQueries({ queryKey: ['plans'] }); setEditing(null); }} />}
    </>
  );
}

function PlanModal({ plan, onClose, onDone }: { plan: PlanDto | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<PlanInput>(plan ? { key: plan.key, name: plan.name, priceCents: plan.priceCents, billingInterval: plan.billingInterval, limits: plan.limits, active: plan.active } : EMPTY);
  const [price, setPrice] = useState(plan ? String(plan.priceCents / 100) : '0');
  const [err, setErr] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: () => plan ? api(`/plans/${plan.id}`, { method: 'PATCH', body: f }) : api('/plans', { method: 'POST', body: f }),
    onSuccess: onDone, onError: setErr,
  });
  const fe = fieldErrors(err);
  const setLimit = (k: Exclude<keyof PlanLimits, 'aiAgent'>, v: number | undefined) => setF({ ...f, limits: { ...f.limits, [k]: v } });

  return (
    <Modal title={plan ? 'Editar plano' : 'Novo plano'} onClose={onClose} wide footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      {err != null && !Object.keys(fe).length && <div className="alert" style={{ marginBottom: 14 }}>{errorMessage(err)}</div>}
      <div className="form-grid g3">
        <Field label="Nome" className="span-2" error={fe.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Chave (identificador)" error={fe.key} hint="letras minúsculas, números e hífen"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} disabled={!!plan} /></Field>
        <Field label="Preço (R$)"><Input type="number" min={0} step="0.01" value={price} onChange={(e) => { setPrice(e.target.value); setF({ ...f, priceCents: Math.round(Number(e.target.value || 0) * 100) }); }} /></Field>
        <Field label="Cobrança">
          <Select value={f.billingInterval} onChange={(e) => setF({ ...f, billingInterval: e.target.value as PlanInput['billingInterval'] })}>
            {Object.entries(BILLING_INTERVAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
            <option value="1">Ativo</option><option value="0">Inativo (não pode ser escolhido em novas licenças)</option>
          </Select>
        </Field>
      </div>

      <p className="label" style={{ marginTop: 20, marginBottom: 10 }}>Limites (vazio = sem limite)</p>
      <div className="form-grid g3">
        {LIMIT_KEYS.filter((k) => k !== 'aiAgent').map((k) => (
          <Field key={k} label={PLAN_LIMIT_LABELS[k]}>
            <Input type="number" min={0} value={f.limits[k] ?? ''} onChange={(e) => setLimit(k, e.target.value === '' ? undefined : Number(e.target.value))} />
          </Field>
        ))}
      </div>
      <label className="checkline" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={!!f.limits.aiAgent} onChange={(e) => setF({ ...f, limits: { ...f.limits, aiAgent: e.target.checked || undefined } })} /> Inclui agente de atendimento por IA
      </label>
    </Modal>
  );
}
