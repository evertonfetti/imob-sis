import { VISIT_STATUSES, VISIT_STATUS_LABELS, type Paginated } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { VisitCard, VisitModal, type VisitRow } from '../components/commercial';
import { useBrokers } from '../components/crm';
import { Button, Empty, PageHeader, Select, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function Agenda() {
  const { can } = useAuth();
  const brokers = useBrokers();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [broker, setBroker] = useState(can('lead.view_all') ? '' : 'me');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<VisitRow | 'new' | null>(null);

  const weekEnd = addDays(weekStart, 7);
  const params = new URLSearchParams({ from: weekStart.toISOString(), to: weekEnd.toISOString(), pageSize: '200', ...(broker && { brokerId: broker }), ...(status && { status }) }).toString();
  const q = useQuery({ queryKey: ['visits', params], queryFn: () => api<Paginated<VisitRow>>(`/visits?${params}`), placeholderData: (p) => p });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, VisitRow[]>();
    for (const v of q.data?.items ?? []) { const k = dayKey(new Date(v.scheduledAt)); m.set(k, [...(m.get(k) ?? []), v]); }
    return m;
  }, [q.data]);
  const todayKey = dayKey(new Date());
  const label = `${weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
  const total = q.data?.items.length ?? 0;

  return (
    <>
      <PageHeader title="Agenda" subtitle="Visitas agendadas com os seus clientes."
        actions={can('visit.create') && <Button variant="primary" onClick={() => setModal('new')}><Plus /> Agendar visita</Button>} />
      <div className="card">
        <div className="filters" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="week-nav">
            <Button variant="ghost" size="icon" aria-label="Semana anterior" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft /></Button>
            <strong>{label}</strong>
            <Button variant="ghost" size="icon" aria-label="Próxima semana" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight /></Button>
            <Button onClick={() => setWeekStart(startOfWeek(new Date()))}>Hoje</Button>
          </div>
          <div className="toolbar">
            {can('lead.view_all') && (
              <Select style={{ width: 190 }} value={broker} onChange={(e) => setBroker(e.target.value)} aria-label="Corretor">
                <option value="">Toda a equipe</option><option value="me">Minhas visitas</option>
                {brokers.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
            <Select style={{ width: 190 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
              <option value="">Todas as situações</option>{VISIT_STATUSES.map((s) => <option key={s} value={s}>{VISIT_STATUS_LABELS[s]}</option>)}
            </Select>
          </div>
        </div>
        {q.isLoading ? <SkeletonRows rows={5} /> : total === 0 ? (
          <Empty icon={<CalendarDays />} title="Nenhuma visita nesta semana" hint="Agende a partir do lead ou pelo botão “Agendar visita”." />
        ) : days.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          if (!list.length) return null;
          const today = dayKey(d) === todayKey;
          return (
            <div key={dayKey(d)}>
              <div className={`agenda-day ${today ? 'today' : ''}`}><span>{d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span><span>{today ? 'Hoje · ' : ''}{list.length} {list.length === 1 ? 'visita' : 'visitas'}</span></div>
              {list.map((v) => <VisitCard key={v.id} v={v} onEdit={setModal} />)}
            </div>
          );
        })}
      </div>
      {modal && <VisitModal visit={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => setModal(null)} />}
    </>
  );
}
