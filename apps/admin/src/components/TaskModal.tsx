import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_TYPES, TASK_TYPE_LABELS } from '@imob/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { toLocalInput } from '../lib/format';
import { SearchPicker } from './SearchPicker';
import { searchLeads, useBrokers } from './crm';
import { Button, Field, Input, Modal, Select, errorMessage, fieldErrors } from './ui';

export interface TaskRow {
  id: string; title: string; description: string | null; type: keyof typeof TASK_TYPE_LABELS; priority: keyof typeof TASK_PRIORITY_LABELS;
  status: 'OPEN' | 'DONE' | 'CANCELLED'; dueAt: string | null; completedAt: string | null; leadId: string | null; assignedUserId: string | null;
  lead?: { id: string; customer: { id: string; name: string } } | null;
  property?: { id: string; code: string } | null;
  assignedUser?: { id: string; name: string } | null;
}

/** Criar ou editar tarefa. Com `leadId` fixo, a tarefa nasce vinculada àquele lead. */
export function TaskModal({ task, leadId, onClose, onSaved }: { task?: TaskRow | null; leadId?: string; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const brokers = useBrokers();
  const [lead, setLead] = useState<{ id: string; label: string; sub?: string } | null>(
    task?.lead ? { id: task.lead.id, label: task.lead.customer.name } : null);
  const [f, setF] = useState({
    title: task?.title ?? '', type: task?.type ?? 'FOLLOW_UP', priority: task?.priority ?? 'MEDIUM',
    dueAt: toLocalInput(task?.dueAt), assignedUserId: task?.assignedUserId ?? '', description: task?.description ?? '',
  });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: f.title, type: f.type, priority: f.priority, description: f.description || null,
        dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, ...(f.assignedUserId && { assignedUserId: f.assignedUserId }),
      };
      return task ? api(`/tasks/${task.id}`, { method: 'PATCH', body }) : api('/tasks', { method: 'POST', body: { ...body, leadId: leadId ?? lead?.id ?? null } });
    },
    onSuccess: () => { for (const k of ['tasks', 'lead', 'board']) qc.invalidateQueries({ queryKey: [k] }); onSaved(); },
    onError: setErr,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); e.stopPropagation(); setErr(null); save.mutate(); };
  return (
    <Modal title={task ? 'Editar tarefa' : 'Nova tarefa'} onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" form="task-form" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></>}>
      <form id="task-form" className="form-grid" onSubmit={submit}>
        {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
        <Field label="O que precisa ser feito?" className="span-2" error={fe.title}><Input autoFocus required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Ligar para apresentar as opções" /></Field>
        <Field label="Tipo"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as never })}>{TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="Prioridade"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as never })}>{TASK_PRIORITIES.map((t) => <option key={t} value={t}>{TASK_PRIORITY_LABELS[t]}</option>)}</Select></Field>
        <Field label="Prazo"><Input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
        <Field label="Responsável"><Select value={f.assignedUserId} onChange={(e) => setF({ ...f, assignedUserId: e.target.value })}><option value="">Padrão (responsável do lead ou eu)</option>{brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        {!task && !leadId && (
          <div className="span-2 field"><label>Lead (opcional)</label><SearchPicker queryKey="pick-lead" value={lead} onChange={setLead} search={searchLeads} placeholder="Buscar lead pelo nome do cliente…" /></div>
        )}
        <Field label="Detalhes" className="span-2"><textarea className="input textarea" style={{ minHeight: 70 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}
