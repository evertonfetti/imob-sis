import type { BoardColumn, StageDto } from '@imob/types';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Building2, Plus, Search, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LostModal, NewLeadModal, sourceLabel, useBrokers, usePipeline } from '../components/crm';
import { Button, Field, Input, Modal, PageHeader, Select, Spinner, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { initials, timeAgo } from '../lib/format';

interface Board { pipeline: { id: string; name: string }; columns: BoardColumn[] }

export function Pipeline() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const [source, setSource] = useState('');
  const [newLead, setNewLead] = useState(false);
  const [config, setConfig] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [lost, setLost] = useState<{ leadId: string; stageId: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerX = useRef<number | null>(null);
  const brokers = useBrokers();
  const canMove = can('crm.pipeline');
  const canAll = can('lead.view_all');

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ ...(debounced && { search: debounced }), ...(brokerId && { brokerId }), ...(source && { source }) }).toString();
  const board = useQuery({ queryKey: ['board', qs], queryFn: () => api<Board>(`/pipeline/board${qs ? `?${qs}` : ''}`), refetchInterval: 30_000, placeholderData: (p) => p });

  // Cópia local para mover o cartão na hora (otimista) e reverter se a API recusar.
  const [cols, setCols] = useState<BoardColumn[]>([]);
  useEffect(() => { if (board.data) setCols(board.data.columns); }, [board.data]);

  const move = useMutation({
    mutationFn: (v: { leadId: string; stageId: string; lostReason?: string }) =>
      api(`/leads/${v.leadId}/change-stage`, { method: 'POST', body: { stageId: v.stageId, ...(v.lostReason && { lostReason: v.lostReason }) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['board'] }); qc.invalidateQueries({ queryKey: ['leads'] }); setLost(null); },
    onError: (e) => { toast.show(errorMessage(e)); qc.invalidateQueries({ queryKey: ['board'] }); setLost(null); },
  });

  function drop(stage: StageDto) {
    setOverStage(null);
    const id = dragId; setDragId(null);
    if (!id) return;
    const from = cols.find((c) => c.leads.some((l) => l.id === id));
    if (!from || from.stage.id === stage.id) return;
    if (stage.type === 'LOST') { setLost({ leadId: id, stageId: stage.id }); return; }
    const card = from.leads.find((l) => l.id === id)!;
    setCols(cols.map((c) => c.stage.id === from.stage.id ? { ...c, total: c.total - 1, leads: c.leads.filter((l) => l.id !== id) }
      : c.stage.id === stage.id ? { ...c, total: c.total + 1, leads: [{ ...card, stageEnteredAt: new Date().toISOString() }, ...c.leads] } : c));
    move.mutate({ leadId: id, stageId: stage.id });
  }

  // Auto-scroll horizontal enquanto um cartão é arrastado perto das bordas do quadro.
  useEffect(() => {
    if (!dragId) { pointerX.current = null; return; }
    const timer = setInterval(() => {
      const el = wrapRef.current; const x = pointerX.current;
      if (!el || x == null) return;
      const r = el.getBoundingClientRect();
      if (x > r.right - 110) el.scrollLeft += 22;
      else if (x < r.left + 110) el.scrollLeft -= 22;
    }, 16);
    return () => clearInterval(timer);
  }, [dragId]);

  const total = cols.reduce((n, c) => n + c.total, 0);

  return (
    <>
      <PageHeader title="Pipeline" subtitle={board.data ? `${total} ${total === 1 ? 'lead' : 'leads'} no funil · arraste os cartões entre as etapas.` : 'Acompanhe cada lead até o fechamento.'}
        actions={<>
          {can('crm.manage') && <Button onClick={() => setConfig(true)}><Settings2 /> Configurar funil</Button>}
          {can('lead.create') && <Button variant="primary" onClick={() => setNewLead(true)}><Plus /> Novo lead</Button>}
        </>} />

      <div className="toolbar" style={{ marginBottom: 18 }}>
        <div className="input-icon" style={{ width: 300, maxWidth: '100%' }}><Search /><Input placeholder="Buscar cliente, telefone ou imóvel" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {canAll && (
          <Select style={{ width: 200 }} value={brokerId} onChange={(e) => setBrokerId(e.target.value)} aria-label="Responsável">
            <option value="">Todos os responsáveis</option><option value="none">Sem responsável</option>
            {brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Select style={{ width: 160 }} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Origem">
          <option value="">Todas as origens</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>)}
        </Select>
        {board.isFetching && <Spinner />}
      </div>

      {board.isLoading ? <div className="center-screen" style={{ height: 300 }}><Spinner /></div> : (
        <div className={`board-wrap ${dragId ? 'is-dragging' : ''}`} ref={wrapRef} onDragOver={(e) => { if (dragId) pointerX.current = e.clientX; }}>
          <div className="board">
            {cols.map(({ stage, total: count, leads }) => (
              <section key={stage.id} className={`col ${overStage === stage.id ? 'over' : ''}`} aria-label={stage.name}
                onDragOver={(e) => { if (dragId && canMove) { e.preventDefault(); setOverStage(stage.id); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null); }}
                onDrop={(e) => { e.preventDefault(); drop(stage); }}>
                <div className="col-head"><span className="col-dot" style={{ background: stage.color }} /><span className="col-name" title={stage.name}>{stage.name}</span><span className="col-count">{count}</span></div>
                <div className="col-body">
                  {leads.map((l) => (
                    <div key={l.id} className={`lcard ${dragId === l.id ? 'dragging' : ''}`} draggable={canMove} role="button" tabIndex={0}
                      onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); }}
                      onDragEnd={() => { setDragId(null); setOverStage(null); }}
                      onClick={() => nav(`/leads/${l.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/leads/${l.id}`)}>
                      <div className="lcard-top">
                        <span className="lcard-name">{l.customer.name}</span>
                        {l.broker ? <div className="avatar avatar-sm" title={l.broker.name}>{initials(l.broker.name)}</div> : <span className="mini" title="Sem responsável">Sem resp.</span>}
                      </div>
                      <div className="lcard-meta">
                        {l.property && <span className="mini"><Building2 />{l.property.code}</span>}
                        <span className="mini">{sourceLabel(l.source)}</span>
                        {l.overdueTasks > 0 && <span className="mini danger" title="Tarefas atrasadas"><AlarmClock />{l.overdueTasks}</span>}
                      </div>
                      <div className="lcard-foot"><span title={`Entrou na etapa em ${new Date(l.stageEnteredAt).toLocaleString('pt-BR')}`}>na etapa {timeAgo(l.stageEnteredAt)}</span></div>
                    </div>
                  ))}
                  {leads.length === 0 && <div className="col-empty">Nenhum lead</div>}
                  {count > leads.length && <Link className="col-more" to={`/leads?stageId=${stage.id}`}>Ver todos os {count} →</Link>}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {newLead && <NewLeadModal onClose={() => setNewLead(false)} onCreated={(id) => { setNewLead(false); nav(`/leads/${id}`); }} />}
      {lost && <LostModal busy={move.isPending} onClose={() => setLost(null)} onConfirm={(reason) => move.mutate({ leadId: lost.leadId, stageId: lost.stageId, lostReason: reason })} />}
      {config && <StagesModal onClose={() => setConfig(false)} />}
      {toast.node}
    </>
  );
}

function StagesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const pipeline = usePipeline();
  const [edits, setEdits] = useState<Record<string, { name: string; color: string }>>({});
  const [err, setErr] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: async () => { for (const [id, v] of Object.entries(edits)) await api(`/pipeline/stages/${id}`, { method: 'PATCH', body: v }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipeline'] }); qc.invalidateQueries({ queryKey: ['board'] }); onClose(); },
    onError: setErr,
  });
  const val = (s: StageDto) => edits[s.id] ?? { name: s.name, color: s.color };
  return (
    <Modal title="Configurar funil" onClose={onClose}
      footer={<><Button type="button" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!Object.keys(edits).length || save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      {err != null && <div className="alert" style={{ marginBottom: 12 }}>{errorMessage(err)}</div>}
      <p className="card-sub" style={{ marginBottom: 14 }}>Renomeie as etapas e escolha as cores. A ordem e os tipos (Fechado/Perdido) são fixos.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {pipeline.data?.stages.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="color" className="swatch" value={val(s).color} aria-label={`Cor de ${s.name}`} onChange={(e) => setEdits({ ...edits, [s.id]: { ...val(s), color: e.target.value } })} />
            <Input value={val(s).name} maxLength={40} onChange={(e) => setEdits({ ...edits, [s.id]: { ...val(s), name: e.target.value } })} aria-label={`Nome da etapa ${s.position + 1}`} />
            {s.type !== 'OPEN' && <span className="card-sub" style={{ whiteSpace: 'nowrap' }}>{s.type === 'WON' ? 'Ganho' : 'Perda'}</span>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
