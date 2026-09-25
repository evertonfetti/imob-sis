import { TASK_PRIORITY_LABELS, TASK_TYPE_LABELS, type Paginated } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TaskModal, type TaskRow } from '../components/TaskModal';
import { Badge, Button, Empty, PageHeader, Select, SkeletonRows, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dueLabel } from '../lib/format';

const VIEWS = [['open', 'Abertas'], ['today', 'Hoje'], ['overdue', 'Atrasadas'], ['done', 'Concluídas']] as const;
const PRIORITY_TONE = { HIGH: 'danger', MEDIUM: 'warn', LOW: undefined } as const;

/** Início e fim do dia no fuso do navegador (o servidor não conhece o fuso do usuário). */
function todayRange() {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
}

export function Tasks() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('open');
  const [mine, setMine] = useState(true);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<TaskRow | 'new' | null>(null);
  const canAll = can('lead.view_all');

  const params = new URLSearchParams({ page: String(page), pageSize: '25', view, ...(mine || !canAll ? { assignedUserId: 'me' } : {}), ...(view === 'today' ? todayRange() : {}) }).toString();
  const q = useQuery({ queryKey: ['tasks', params], queryFn: () => api<Paginated<TaskRow>>(`/tasks?${params}`), placeholderData: (p) => p });
  const complete = useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}/complete`, { method: 'POST' }),
    onSuccess: () => { for (const k of ['tasks', 'lead', 'board']) qc.invalidateQueries({ queryKey: [k] }); },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Tarefas" subtitle="O que precisa ser feito para os seus leads avançarem."
        actions={can('lead.edit') && <Button variant="primary" onClick={() => setModal('new')}><Plus /> Nova tarefa</Button>} />
      <div className="seg" role="tablist" style={{ display: 'flex' }}>
        {VIEWS.map(([k, label]) => <button key={k} role="tab" className={view === k ? 'active' : ''} onClick={() => { setView(k); setPage(1); }}>{label}</button>)}
      </div>
      <div className="card">
        {canAll && (
          <div className="filters" style={{ borderBottom: '1px solid var(--line)' }}>
            <Select style={{ width: 220 }} value={mine ? 'me' : 'all'} onChange={(e) => { setMine(e.target.value === 'me'); setPage(1); }} aria-label="Responsável">
              <option value="me">Minhas tarefas</option><option value="all">Da equipe toda</option>
            </Select>
          </div>
        )}
        {q.isLoading ? <SkeletonRows rows={6} /> : !d?.items.length ? (
          <Empty icon={<ListChecks />} title={view === 'done' ? 'Nada concluído ainda' : view === 'overdue' ? 'Nenhuma tarefa atrasada' : 'Tudo em dia'} hint="Novos leads geram uma tarefa de primeiro contato automaticamente." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 44 }} /><th>Tarefa</th><th>Lead</th><th>Prazo</th><th>Prioridade</th><th>Responsável</th></tr></thead>
              <tbody>
                {d.items.map((t) => {
                  const done = t.status === 'DONE';
                  const due = dueLabel(done ? t.completedAt : t.dueAt, done);
                  return (
                    <tr key={t.id}>
                      <td><button className={`task-check ${done ? 'done' : ''}`} aria-label={done ? 'Concluída' : 'Concluir'} disabled={done || !can('lead.edit')} onClick={() => complete.mutate(t.id)}><Check /></button></td>
                      <td><span className={`task-title ${done ? 'done' : ''}`} style={{ cursor: !done && can('lead.edit') ? 'pointer' : 'default' }} onClick={() => !done && can('lead.edit') && setModal(t)}>{t.title}</span>
                        <div className="card-sub">{TASK_TYPE_LABELS[t.type]}</div></td>
                      <td>{t.lead ? <Link to={`/leads/${t.lead.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>{t.lead.customer.name}</Link> : <span className="card-sub">—</span>}</td>
                      <td className={`due ${due.late ? 'late' : ''}`} style={{ whiteSpace: 'nowrap' }}>{done ? `Feita ${due.text.toLowerCase()}` : due.text}</td>
                      <td><Badge tone={PRIORITY_TONE[t.priority]} plain>{TASK_PRIORITY_LABELS[t.priority]}</Badge></td>
                      <td className="card-sub">{t.assignedUser?.name ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>{d.total} tarefas · página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
      {modal && <TaskModal task={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => setModal(null)} />}
      {toast.node}
    </>
  );
}
