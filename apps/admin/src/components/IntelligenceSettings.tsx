import { INTELLIGENCE_SETTING_LIMITS, type IntelligenceSettings, type IntelligenceSettingsDto } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, Field, Input, SkeletonRows, errorMessage, useToast } from './ui';

type NumKey = keyof typeof INTELLIGENCE_SETTING_LIMITS;
const GROUPS: { title: string; sub: string; fields: { key: NumKey; label: string; unit: string; hint?: string }[] }[] = [
  { title: 'Alertas de atendimento', sub: 'Quando um lead ou cliente passa do prazo, aparece em “Precisa de atenção”.', fields: [
    { key: 'unattendedHours', label: 'Lead novo sem atendimento', unit: 'horas', hint: 'Primeiro alerta.' },
    { key: 'unattendedHighHours', label: 'Lead sem atendimento: urgente', unit: 'horas', hint: 'Deve ser maior que o primeiro alerta.' },
    { key: 'whatsappWaitingHours', label: 'Cliente esperando resposta no WhatsApp', unit: 'horas' },
    { key: 'staleDays', label: 'Lead parado na mesma etapa', unit: 'dias' },
  ] },
  { title: 'Visitas e propostas', sub: 'Prazos para não deixar negociações esfriarem.', fields: [
    { key: 'visitUnconfirmedHours', label: 'Visita sem confirmação, faltando até', unit: 'horas' },
    { key: 'proposalExpiringHours', label: 'Proposta vencendo em até', unit: 'horas' },
    { key: 'proposalIdleDays', label: 'Proposta sem movimento', unit: 'dias' },
  ] },
  { title: 'Sugestão de imóveis', sub: 'Nota de compatibilidade de 0 a 100.', fields: [
    { key: 'matchMinScore', label: 'Nota mínima para sugerir', unit: '%', hint: 'Abaixo disso o imóvel não aparece nas sugestões.' },
    { key: 'matchAutoTaskScore', label: 'Nota para criar tarefa automática', unit: '%', hint: 'Ao publicar um imóvel novo. Deve ser igual ou maior que a mínima.' },
  ] },
];

/** Limites de alertas e automações da empresa, com uma régua medida nos próprios dados para acertar os valores. */
export function IntelligenceSettingsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['intelligence-settings'], queryFn: () => api<IntelligenceSettingsDto>('/intelligence/settings') });
  const [f, setF] = useState<IntelligenceSettings | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setF(q.data.settings); }, [q.data]);
  const done = (d: IntelligenceSettingsDto) => { qc.setQueryData(['intelligence-settings'], d); qc.invalidateQueries({ queryKey: ['alerts'] }); setErr(null); toast.show('Configurações salvas.'); };
  const save = useMutation({ mutationFn: () => api<IntelligenceSettingsDto>('/intelligence/settings', { method: 'PUT', body: f }), onSuccess: done, onError: setErr });
  const reset = useMutation({ mutationFn: () => api<IntelligenceSettingsDto>('/intelligence/settings/reset', { method: 'POST' }), onSuccess: done, onError: setErr });
  if (!q.data || !f) return <div className="card"><SkeletonRows rows={5} /></div>;
  const { insights, defaults } = q.data;
  const changed = JSON.stringify(f) !== JSON.stringify(q.data.settings);
  const fmt = (n: number, unit: string) => (n < 1 ? `menos de 1 ${unit}` : `${String(n).replace('.', ',')} ${unit}`);
  const ruler = (key: NumKey) => {
    if (key === 'unattendedHours' || key === 'unattendedHighHours') return insights.firstStageHours && `Na sua operação, metade dos leads sai da primeira etapa em ${fmt(insights.firstStageHours.median, 'h')} e 80% em ${fmt(insights.firstStageHours.p80, 'h')} (${insights.firstStageHours.samples} leads).`;
    if (key === 'staleDays') return insights.otherStagesDays && `Nas demais etapas, metade dos leads avança em ${fmt(insights.otherStagesDays.median, 'dia')} e 80% em ${fmt(insights.otherStagesDays.p80, 'dia')} (${insights.otherStagesDays.samples} passagens).`;
    return null;
  };

  return (
    <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); }}>
      {err != null && <div className="alert">{errorMessage(err)}</div>}
      <p className="card-sub">Ajuste até achar o ponto certo para a sua equipe: curto demais gera alertas em excesso, longo demais deixa o lead esfriar. As sugestões abaixo são medidas nos seus próprios dados.</p>
      {GROUPS.map((g) => (
        <section key={g.title} className="card">
          <div className="card-head"><div><div className="card-title">{g.title}</div><div className="card-sub">{g.sub}</div></div></div>
          <div className="section-body">
            <div className="form-grid">
              {g.fields.map((fl) => {
                const [min, max] = INTELLIGENCE_SETTING_LIMITS[fl.key];
                const r = ruler(fl.key);
                return (
                  <Field key={fl.key} label={fl.label} hint={[fl.hint, `Padrão ${defaults[fl.key]} ${fl.unit} · de ${min} a ${max}`].filter(Boolean).join(' ')}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input type="number" min={min} max={max} required value={f[fl.key]} onChange={(e) => setF({ ...f, [fl.key]: e.target.value === '' ? ('' as never) : Number(e.target.value) })} style={{ maxWidth: 120 }} />
                      <span className="card-sub">{fl.unit}</span>
                    </div>
                    {r && <span className="field-hint" style={{ color: 'var(--accent)' }}>{r}</span>}
                  </Field>
                );
              })}
            </div>
          </div>
        </section>
      ))}
      <section className="card">
        <div className="card-head"><div><div className="card-title">Tarefas automáticas</div><div className="card-sub">O sistema cria tarefas para o responsável do lead.</div></div></div>
        <div className="section-body" style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={f.autoStaleTasks} onChange={(e) => setF({ ...f, autoStaleTasks: e.target.checked })} /> Retomar contato com leads parados <span className="card-sub">(uma tarefa a cada período parado)</span></label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={f.autoMatchTasks} onChange={(e) => setF({ ...f, autoMatchTasks: e.target.checked })} /> Apresentar imóveis novos a leads compatíveis <span className="card-sub">(ao publicar o imóvel)</span></label>
        </div>
      </section>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <Button type="button" variant="ghost" disabled={reset.isPending} onClick={() => confirm('Voltar todos os limites para os valores padrão do sistema?') && reset.mutate()}>Restaurar padrões</Button>
        <Button variant="primary" disabled={!changed || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar configurações'}</Button>
      </div>
      {toast.node}
    </form>
  );
}
