import {
  AGENT_LIMITS, AI_TIER_LABELS, DOCUMENT_MAX_BYTES,
  type AgentRunDto, type AgentSettings, type AgentSettingsDto, type AgentTestResult, type AiDocumentDto,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Send, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { SearchPicker } from './SearchPicker';
import { searchProperties } from './crm';
import { Badge, Button, Field, Input, SkeletonRows, errorMessage, useToast } from './ui';

const CT: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' };
const contentTypeOf = (f: File) => CT[f.name.split('.').pop()?.toLowerCase() ?? ''] ?? f.type;

export function AgentCard({ onGoToAccounts }: { onGoToAccounts: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['agent-settings'], queryFn: () => api<AgentSettingsDto>('/agent/settings') });
  const [f, setF] = useState<AgentSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setF(q.data.settings); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api<AgentSettingsDto>('/agent/settings', { method: 'PUT', body: f }),
    onSuccess: (d) => { qc.setQueryData(['agent-settings'], d); setErr(null); toast.show(d.settings.enabled ? 'Agente ativado.' : 'Configuração salva.'); },
    onError: (e) => setErr(errorMessage(e)),
  });
  if (!q.data || !f) return <div className="card"><SkeletonRows rows={5} /></div>;
  const d = q.data;
  const changed = JSON.stringify(f) !== JSON.stringify(d.settings);
  const num = (k: 'maxReplies' | 'maxPhotos' | 'replyDelaySec') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === '' ? ('' as never) : Number(e.target.value) });

  return (
    <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); }}>
      <div className="card-head">
        <div><div className="card-title">Agente de atendimento por IA</div><div className="card-sub">Atende os leads no WhatsApp na hora: conversa, tira dúvidas, envia fotos e chama uma pessoa quando precisa.</div></div>
        <Badge tone={d.settings.enabled ? 'ok' : undefined}>{d.settings.enabled ? 'Ativo' : 'Desativado'}</Badge>
      </div>
      <div className="section-body">
        {err && <div className="alert" style={{ marginBottom: 14 }}>{err}</div>}
        {!d.whatsappConnected && <div className="alert" style={{ marginBottom: 14 }}>O WhatsApp ainda não está conectado. Configure em <strong>Integrações</strong> para o agente poder responder.</div>}
        <div className="form-grid">
          <label className="span-2" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="switch"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><i /></span>
            <span><strong style={{ fontWeight: 550 }}>Responder automaticamente</strong> <span className="card-sub">as mensagens novas dos clientes, enquanto a conversa estiver com o assistente</span></span>
          </label>
          <Field label="Nome do assistente"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} /></Field>
          <Field label="Modelo de texto" hint={d.textModels.length ? 'Modelos “Premium” respondem melhor; “Econômico” custa menos.' : undefined}>
            {d.textModels.length ? (
              <select className="select" value={f.modelId ?? ''} onChange={(e) => setF({ ...f, modelId: e.target.value || null })}>
                <option value="">Escolha um modelo…</option>
                {d.textModels.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.accountName} · {AI_TIER_LABELS[m.tier as keyof typeof AI_TIER_LABELS]}{m.priced ? '' : ' (sem custo informado)'}</option>)}
              </select>
            ) : <div className="card-sub">Nenhum modelo de texto cadastrado. <button type="button" className="linklike" onClick={onGoToAccounts}>Cadastre uma conta de IA</button> e marque um modelo de “Gerar texto e conversar”.</div>}
          </Field>
          <Field label="Orientações da imobiliária" className="span-2" hint="Tom de voz, regras e o que o assistente nunca deve prometer. Ex.: “Nunca informe valores de comissão. Trate o cliente por você.”">
            <textarea className="input textarea" style={{ minHeight: 90 }} maxLength={3000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
          </Field>
          <Field label="Mensagem ao transferir para uma pessoa" className="span-2"><Input value={f.handoffMessage} onChange={(e) => setF({ ...f, handoffMessage: e.target.value })} maxLength={300} /></Field>
          <Field label="Máx. de respostas por conversa" hint={`De ${AGENT_LIMITS.maxReplies[0]} a ${AGENT_LIMITS.maxReplies[1]}. Depois disso, transfere para uma pessoa.`}><Input type="number" min={AGENT_LIMITS.maxReplies[0]} max={AGENT_LIMITS.maxReplies[1]} value={f.maxReplies} onChange={num('maxReplies')} /></Field>
          <Field label="Fotos por envio" hint="0 desliga o envio de fotos."><Input type="number" min={AGENT_LIMITS.maxPhotos[0]} max={AGENT_LIMITS.maxPhotos[1]} value={f.maxPhotos} onChange={num('maxPhotos')} /></Field>
          <Field label="Espera antes de responder (segundos)" hint="Junta mensagens seguidas e parece mais natural."><Input type="number" min={AGENT_LIMITS.replyDelaySec[0]} max={AGENT_LIMITS.replyDelaySec[1]} value={f.replyDelaySec} onChange={num('replyDelaySec')} /></Field>
          <div className="field"><label>Neste mês</label><div><strong style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 500 }}>{d.usage.replies}</strong> <span className="card-sub">atendimentos · {d.usage.handoffs} transferências · ≈ US$ {d.usage.costUsd.toFixed(2)}</span></div></div>
        </div>
        <div className="card-sub" style={{ marginTop: 12 }}>Como funciona: o assistente só atende conversas “com o robô”. Quando o cliente pede um atendente, ou o assistente não sabe responder, a conversa passa para uma pessoa e ele para de responder. Você pode assumir ou devolver ao robô a qualquer momento em <strong>Conversas</strong>; conversas finalizadas voltam ao assistente se o cliente escrever de novo.</div>
        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}><Button variant="primary" disabled={!changed || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></div>
      </div>
      {toast.node}
    </form>
  );
}

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function KnowledgeCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['agent-docs'], queryFn: () => api<AiDocumentDto[]>('/agent/documents') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['agent-docs'] });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const contentType = contentTypeOf(f);
      if (f.size > DOCUMENT_MAX_BYTES) throw new Error(`O arquivo passa de ${size(DOCUMENT_MAX_BYTES)}.`);
      const t = await api<{ key: string; uploadUrl: string; headers: Record<string, string> }>('/agent/documents/upload-url', { method: 'POST', body: { filename: f.name, contentType, sizeBytes: f.size } });
      const res = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: f });
      if (!res.ok) throw new Error('Falha no envio do arquivo.');
      return api<AiDocumentDto>('/agent/documents', { method: 'POST', body: { key: t.key, filename: f.name, contentType } });
    },
    onSuccess: (d) => { refresh(); toast.show(d.status === 'READY' ? 'Documento adicionado.' : d.error ?? 'Não foi possível ler o documento.'); },
    onError: (e) => toast.show(e instanceof Error && !(e as { code?: string }).code ? e.message : errorMessage(e)),
  });
  const patch = useMutation({ mutationFn: (v: { id: string; body: object }) => api(`/agent/documents/${v.id}`, { method: 'PATCH', body: v.body }), onSuccess: refresh, onError: (e) => toast.show(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/agent/documents/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); toast.show('Documento removido.'); }, onError: (e) => toast.show(errorMessage(e)) });
  const docs = q.data ?? [];
  return (
    <section className="card">
      <div className="card-head">
        <div><div className="card-title">Base de conhecimento</div><div className="card-sub">Documentos que o assistente consulta para responder (ex.: como funciona o financiamento, documentos para aluguel, regras do condomínio). Além dos imóveis, que ele já lê do sistema.</div></div>
        <Button variant="primary" onClick={() => file.current?.click()} disabled={upload.isPending}><Upload /> {upload.isPending ? 'Lendo…' : 'Enviar documento'}</Button>
      </div>
      <input ref={file} type="file" hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => { const x = e.target.files?.[0]; if (x) upload.mutate(x); e.target.value = ''; }} />
      <div className="section-body" style={{ paddingTop: 4 }}>
        {q.isLoading ? <SkeletonRows rows={2} /> : !docs.length ? <div className="card-sub" style={{ padding: '12px 0' }}>Nenhum documento ainda. Aceita PDF, DOCX, TXT, MD e CSV com texto (até {size(DOCUMENT_MAX_BYTES)}).</div> : docs.map((d) => (
          <div key={d.id} className={`doc-row ${d.active ? '' : 'off'}`}>
            <FileText size={18} style={{ color: 'var(--faint)', flex: 'none' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <input className="doc-title" defaultValue={d.title} maxLength={120} aria-label="Título" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.title && patch.mutate({ id: d.id, body: { title: e.target.value.trim() } })} />
              <div className="card-sub">{d.filename} · {size(d.sizeBytes)}{d.status === 'READY' ? ` · ${d.chunks} trechos` : ''}{d.error ? ` · ${d.error}` : ''}</div>
            </div>
            <Badge tone={d.status === 'READY' ? 'ok' : d.status === 'FAILED' ? 'danger' : 'warn'} plain>{d.status === 'READY' ? 'Pronto' : d.status === 'FAILED' ? 'Falhou' : 'Lendo'}</Badge>
            {d.status === 'READY' && <label className="switch" title={d.active ? 'O assistente usa este documento' : 'Desativado'}><input type="checkbox" checked={d.active} onChange={(e) => patch.mutate({ id: d.id, body: { active: e.target.checked } })} /><i /></label>}
            <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => confirm(`Remover “${d.title}”?`) && remove.mutate(d.id)}><Trash2 size={15} /></Button>
          </div>
        ))}
      </div>
      {toast.node}
    </section>
  );
}

interface Turn { role: 'user' | 'assistant'; content: string; result?: AgentTestResult }

/** Conversa de teste: mostra o que o assistente responderia, sem enviar nada ao cliente nem alterar leads. */
export function AgentTestCard() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [property, setProperty] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: (msgs: Turn[]) => api<AgentTestResult>('/agent/test', { method: 'POST', body: { messages: msgs.map(({ role, content }) => ({ role, content })), propertyId: property?.id ?? null } }),
    onSuccess: (r) => { setTurns((t) => [...t, { role: 'assistant', content: r.reply || '(sem texto, só ações)', result: r }]); setErr(null); },
    onError: (e) => setErr(errorMessage(e)),
  });
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns.length, send.isPending]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!text.trim() || send.isPending) return; const next = [...turns, { role: 'user' as const, content: text.trim() }]; setTurns(next); setText(''); send.mutate(next); };
  return (
    <section className="card">
      <div className="card-head"><div><div className="card-title">Testar o assistente</div><div className="card-sub">Converse como se fosse o cliente. Nada é enviado por WhatsApp nem gravado em leads. Salve a configuração antes de testar.</div></div>
        {turns.length > 0 && <Button variant="ghost" onClick={() => { setTurns([]); setErr(null); }}>Limpar</Button>}</div>
      <div className="section-body" style={{ display: 'grid', gap: 12 }}>
        <div className="field"><label>Imóvel em contexto (opcional)</label><SearchPicker queryKey="pick-property" value={property} onChange={setProperty} search={searchProperties} placeholder="Simular um cliente que veio de um imóvel…" /></div>
        <div className="test-chat">
          {!turns.length && <div className="card-sub" style={{ padding: 16 }}>Ex.: “Oi, vi o apartamento no site. Como funciona o financiamento?”</div>}
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role === 'assistant' ? 'out' : ''}`} style={{ maxWidth: '86%' }}>
              <div className="bubble-text">{t.content}</div>
              {t.result && (
                <div className="test-meta">
                  {t.result.handoff && <Badge tone="warn">Transferiria para uma pessoa</Badge>}
                  {t.result.actions.map((a, k) => <Badge key={k} plain>{({ send_photos: 'Enviaria fotos', update_lead: 'Atualizaria o lead', request_visit: 'Pediria visita', handoff: 'Transferir' } as Record<string, string>)[a.type] ?? a.type}{a.detail ? `: ${a.detail}` : ''}</Badge>)}
                  {t.result.sources.length > 0 && <details><summary>Consultou {t.result.sources.length} {t.result.sources.length === 1 ? 'trecho' : 'trechos'} de documentos</summary>{t.result.sources.map((s, k) => <div key={k} className="card-sub"><strong>{s.document}:</strong> {s.excerpt}…</div>)}</details>}
                  <span className="card-sub">{t.result.usage.inputTokens + t.result.usage.outputTokens} tokens · ≈ US$ {t.result.usage.costUsd.toFixed(4)}</span>
                </div>
              )}
            </div>
          ))}
          {send.isPending && <div className="bubble out"><div className="bubble-text card-sub">Pensando…</div></div>}
          <div ref={end} />
        </div>
        {err && <div className="alert">{err}</div>}
        <form className="toolbar" onSubmit={submit}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva como o cliente…" maxLength={2000} style={{ flex: 1 }} />
          <Button variant="primary" disabled={!text.trim() || send.isPending} aria-label="Enviar"><Send /></Button>
        </form>
      </div>
    </section>
  );
}

const OUTCOME: Record<string, { label: string; tone?: 'ok' | 'warn' | 'danger' | 'accent' }> = {
  REPLIED: { label: 'Respondeu', tone: 'ok' }, HANDOFF: { label: 'Transferiu', tone: 'accent' }, ERROR: { label: 'Erro', tone: 'danger' }, DISCARDED: { label: 'Descartada', tone: 'warn' },
};
const ACTION: Record<string, string> = { send_photos: 'fotos', update_lead: 'lead', request_visit: 'visita', handoff: 'transferência' };

export function AgentActivityCard() {
  const q = useQuery({ queryKey: ['agent-runs'], queryFn: () => api<AgentRunDto[]>('/agent/runs?limit=25'), refetchInterval: 20_000 });
  return (
    <section className="card">
      <div className="card-head"><div><div className="card-title">Atividade recente</div><div className="card-sub">O que o assistente fez nas conversas, com o custo de cada resposta.</div></div></div>
      {q.isLoading ? <SkeletonRows rows={3} /> : !q.data?.length ? <div className="section-body card-sub">Nenhuma atividade ainda.</div> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Quando</th><th>Cliente</th><th>Resultado</th><th>Ações</th><th>Modelo</th><th>Custo</th></tr></thead>
            <tbody>{q.data.map((r) => (
              <tr key={r.id}>
                <td className="card-sub" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.createdAt)}</td>
                <td>{r.conversationId ? r.contactName ?? '—' : '—'}</td>
                <td><Badge tone={OUTCOME[r.outcome]?.tone}>{OUTCOME[r.outcome]?.label ?? r.outcome}</Badge>{r.error && <div className="card-sub" title={r.error}>{r.error.slice(0, 50)}</div>}</td>
                <td className="card-sub">{r.actions.map((a) => ACTION[a] ?? a).join(', ') || '—'}</td>
                <td className="card-sub">{r.model}</td>
                <td className="card-sub">≈ US$ {r.costUsd.toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
