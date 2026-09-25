import type { ConversationDto, MessageDto, Paginated } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCheck, Clock, FileText, MessageCircle, Search, Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StagePill } from '../components/crm';
import { Badge, Button, Empty, Field, Input, Select, SkeletonRows, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatPhone, initials, timeAgo } from '../lib/format';

interface Thread extends ConversationDto { messages: MessageDto[] }

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  return d.toDateString() === t.toDateString() ? 'Hoje' : d.toDateString() === y.toDateString() ? 'Ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
};
const phoneOf = (wa: string) => formatPhone(wa.startsWith('55') && wa.length > 11 ? wa.slice(2) : wa);

export function Conversations() {
  const { id } = useParams();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useQuery({
    queryKey: ['conversations', search, unreadOnly],
    queryFn: () => api<Paginated<ConversationDto>>(`/conversations?pageSize=60${search ? `&search=${encodeURIComponent(search)}` : ''}${unreadOnly ? '&unread=true' : ''}`),
    refetchInterval: 8000, placeholderData: (p) => p,
  });
  const items = list.data?.items ?? [];

  return (
    <>
      <div className="page-head"><div><h1 className="page-title">Conversas</h1><p className="page-sub">Atendimento pelo WhatsApp, junto do histórico de cada lead.</p></div></div>
      <div className={`inbox ${id ? 'has-active' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-search">
            <div className="input-icon"><Search /><Input placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Select value={unreadOnly ? 'unread' : 'all'} onChange={(e) => setUnreadOnly(e.target.value === 'unread')} aria-label="Filtro"><option value="all">Todas as conversas</option><option value="unread">Somente não lidas</option></Select>
          </div>
          <div className="inbox-items">
            {list.isLoading ? <SkeletonRows rows={6} /> : !items.length ? (
              <Empty icon={<MessageCircle />} title="Nenhuma conversa" hint="As mensagens recebidas no WhatsApp da imobiliária aparecem aqui." />
            ) : items.map((c) => (
              <div key={c.id} className={`conv ${c.id === id ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => nav(`/conversas/${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/conversas/${c.id}`)}>
                <div className="avatar">{initials(c.contactName ?? c.phone)}</div>
                <div className="conv-body">
                  <div className="conv-top"><span className="conv-name">{c.contactName ?? phoneOf(c.phone)}</span><span className="conv-time">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}</span></div>
                  <div className="conv-prev"><span>{c.lastMessagePreview ?? '—'}</span>{c.unreadCount > 0 && <span className="unread">{c.unreadCount}</span>}</div>
                  {c.lead && <div className="card-sub" style={{ marginTop: 3, fontSize: 12 }}><StagePill stage={c.lead.stage} />{c.lead.property ? ` · ${c.lead.property.code}` : ''}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        {id ? <ThreadView key={id} id={id} /> : <div className="thread"><div className="inbox-empty"><div><MessageCircle size={32} style={{ color: 'var(--line-strong)' }} /><p style={{ marginTop: 8 }}>Selecione uma conversa para começar.</p></div></div></div>}
      </div>
    </>
  );
}

function ThreadView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const bottom = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [tpl, setTpl] = useState(false);
  const [t, setT] = useState({ name: '', language: 'pt_BR', params: '' });
  const q = useQuery({ queryKey: ['conversation', id], queryFn: () => api<Thread>(`/conversations/${id}`), refetchInterval: 5000 });
  const c = q.data;

  const refresh = () => { for (const k of ['conversation', 'conversations', 'conv-unread', 'board']) qc.invalidateQueries({ queryKey: [k] }); };
  // Abrir a conversa marca como lida.
  useEffect(() => { if (c && c.unreadCount > 0) api(`/conversations/${id}/read`, { method: 'POST' }).then(refresh).catch(() => undefined); }, [c?.unreadCount]); // eslint-disable-line
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [c?.messages.length]);

  const send = useMutation({
    mutationFn: (body: object) => api(`/conversations/${id}/messages`, { method: 'POST', body }),
    onSuccess: () => { setText(''); setTpl(false); setT({ name: '', language: 'pt_BR', params: '' }); refresh(); },
    onError: (e) => { toast.show(errorMessage(e)); refresh(); },
  });
  const retry = useMutation({ mutationFn: (mid: string) => api(`/messages/${mid}/retry`, { method: 'POST' }), onSuccess: refresh, onError: (e) => { toast.show(errorMessage(e)); refresh(); } });

  if (q.isLoading) return <div className="thread"><div style={{ padding: 20 }}><SkeletonRows rows={6} /></div></div>;
  if (q.error || !c) return <div className="thread"><div className="inbox-empty"><span>{errorMessage(q.error)}</span></div></div>;

  const canSend = can('lead.edit');
  const submit = (e?: FormEvent) => { e?.preventDefault(); if (text.trim()) send.mutate({ text: text.trim() }); };
  const sendTemplate = (e: FormEvent) => {
    e.preventDefault();
    send.mutate({ template: { name: t.name.trim(), language: t.language.trim() || 'pt_BR', ...(t.params.trim() && { params: t.params.split(',').map((p) => p.trim()).filter(Boolean) }) } });
  };
  let lastDay = '';

  return (
    <div className="thread">
      <div className="thread-head">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <Button variant="ghost" size="icon" className="inbox-back" onClick={() => nav('/conversas')} aria-label="Voltar"><ArrowLeft size={18} /></Button>
          <div className="avatar">{initials(c.contactName ?? c.phone)}</div>
          <div style={{ minWidth: 0 }}><strong>{c.contactName ?? phoneOf(c.phone)}</strong><div className="card-sub">{phoneOf(c.phone)}</div></div>
        </div>
        {c.lead && (
          <div className="toolbar">
            <StagePill stage={c.lead.stage} />
            {c.lead.property && <Badge plain>{c.lead.property.code}</Badge>}
            <Link className="btn btn-sm" to={`/leads/${c.lead.id}`}>Ver lead</Link>
          </div>
        )}
      </div>

      <div className="thread-msgs">
        {c.messages.map((m) => {
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay; lastDay = day;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <span className="day">{day}</span>}
              <Bubble m={m} onRetry={() => retry.mutate(m.id)} canRetry={canSend} />
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {canSend && (
        <div className="composer">
          {!c.windowOpen && !tpl ? (
            <div className="window-note">Já se passaram mais de 24 horas desde a última mensagem do cliente. O WhatsApp só permite enviar <strong>modelos de mensagem aprovados</strong> agora. <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setTpl(true)}>Enviar modelo</button></div>
          ) : tpl || !c.windowOpen ? (
            <form onSubmit={sendTemplate} className="form-grid">
              <Field label="Nome do modelo" hint="Exatamente como aprovado na Meta (minúsculas e _)."><Input required value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="retomada_contato" /></Field>
              <Field label="Idioma"><Input value={t.language} onChange={(e) => setT({ ...t, language: e.target.value })} /></Field>
              <Field label="Variáveis do texto" className="span-2" hint="Separe por vírgula, na ordem ({{1}}, {{2}}…). Deixe em branco se o modelo não tem variáveis."><Input value={t.params} onChange={(e) => setT({ ...t, params: e.target.value })} placeholder="Maria, Casa no Cambuí" /></Field>
              <div className="span-2 toolbar" style={{ justifyContent: 'flex-end' }}>{c.windowOpen && <Button type="button" onClick={() => setTpl(false)}>Cancelar</Button>}<Button variant="primary" disabled={send.isPending}><FileText /> Enviar modelo</Button></div>
            </form>
          ) : (
            <form onSubmit={submit} className="composer-row">
              <textarea className="input textarea" rows={1} placeholder="Escreva uma mensagem…" value={text} maxLength={4096} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
              <Button variant="primary" disabled={!text.trim() || send.isPending} aria-label="Enviar"><Send /></Button>
              <Button type="button" variant="ghost" onClick={() => setTpl(true)} title="Enviar modelo aprovado"><FileText /></Button>
            </form>
          )}
        </div>
      )}
      {toast.node}
    </div>
  );
}

function Media({ m }: { m: MessageDto }) {
  // O arquivo é baixado da Meta na primeira vez que alguém o abre e depois vem do nosso armazenamento.
  const q = useQuery({ queryKey: ['msg-media', m.id], queryFn: () => api<{ url: string; mime: string | null }>(`/messages/${m.id}/media`), staleTime: Infinity, retry: false });
  if (q.isLoading) return <div className="card-sub" style={{ padding: '6px 0' }}>Carregando arquivo…</div>;
  if (q.error || !q.data) return <div className="card-sub" style={{ padding: '6px 0' }}>Arquivo indisponível.</div>;
  const { url, mime } = q.data;
  if (m.type === 'image' || m.type === 'sticker') return <a href={url} target="_blank" rel="noreferrer"><img className="media" src={url} alt="Imagem recebida" loading="lazy" /></a>;
  if (m.type === 'audio') return <audio controls src={url} />;
  if (m.type === 'video') return <video className="media" controls src={url} />;
  return <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer"><FileText /> Abrir arquivo{mime ? ` (${mime.split('/')[1]})` : ''}</a>;
}

function Bubble({ m, onRetry, canRetry }: { m: MessageDto; onRetry: () => void; canRetry: boolean }) {
  const out = m.direction === 'OUTBOUND';
  const failed = m.status === 'FAILED';
  const showText = !(m.hasMedia && /^\[(Imagem|Áudio|Vídeo|Documento|Figurinha)\]$/.test(m.content ?? ''));
  return (
    <div className={`bubble ${out ? 'out' : ''} ${failed ? 'failed' : ''}`}>
      {m.hasMedia && <Media m={m} />}
      {showText && <div className="bubble-text">{m.content}</div>}
      <div className="bubble-meta">
        {out && m.sentBy && <span>{m.sentBy} ·</span>}
        <span>{time(m.createdAt)}</span>
        {out && m.status === 'QUEUED' && <Clock />}
        {out && m.status === 'SENT' && <Check />}
        {out && m.status === 'DELIVERED' && <CheckCheck />}
        {out && m.status === 'READ' && <CheckCheck className="read" />}
        {failed && <span className="err" title={m.error ?? ''}>Falhou{m.error ? `: ${m.error.slice(0, 60)}` : ''}</span>}
        {failed && canRetry && <button type="button" className="btn btn-ghost btn-sm" style={{ height: 22, padding: '0 8px' }} onClick={onRetry}>Reenviar</button>}
      </div>
    </div>
  );
}
