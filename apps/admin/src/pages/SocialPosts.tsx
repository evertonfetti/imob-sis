import {
  SOCIAL_POST_STATUS_LABELS, SOCIAL_PROVIDER_LABELS,
  type Paginated, type SocialAccountDto, type SocialAppDto, type SocialPostDto, type SocialPostStatus,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Check, Facebook, Image as ImageIcon, Instagram, Plus, RotateCw, Send, Share2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';

interface Accounts { configured: boolean; apps: SocialAppDto[]; redirectUri: string; accounts: SocialAccountDto[]; pending: SocialAccountDto[] }

const STATUS_TONE: Record<SocialPostStatus, 'ok' | 'warn' | 'danger' | 'accent' | undefined> = {
  SCHEDULED: 'accent', PUBLISHING: 'warn', PUBLISHED: 'ok', PARTIAL: 'warn', FAILED: 'danger', CANCELLED: undefined,
};
const Icon = ({ provider }: { provider: string }) => (provider === 'INSTAGRAM' ? <Instagram /> : <Facebook />);
const VIEWS = [['scheduled', 'Agendadas'], ['published', 'Publicadas'], ['failed', 'Com falha'], ['', 'Todas']] as const;

export function SocialPosts() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('aba') === 'contas' ? 'contas' : 'posts';
  const setTab = (t: string) => { const n = new URLSearchParams(sp); n.set('aba', t); n.delete('status'); setSp(n); };
  const { can } = useAuth();
  const nav = useNavigate();

  return (
    <>
      <PageHeader title="Redes sociais" subtitle="Publique e agende os seus imóveis no Instagram e no Facebook."
        actions={can('marketing.manage') && <Button variant="primary" onClick={() => nav('/redes-sociais/nova')}><Plus /> Nova publicação</Button>} />
      <div className="seg" role="tablist">
        <button role="tab" className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}>Publicações</button>
        <button role="tab" className={tab === 'contas' ? 'active' : ''} onClick={() => setTab('contas')}>Contas conectadas</button>
      </div>
      {tab === 'posts' ? <Posts /> : <AccountsTab status={sp.get('status')} />}
    </>
  );
}

function Posts() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('scheduled');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['social-posts', view, page],
    queryFn: () => api<Paginated<SocialPostDto>>(`/social/posts?page=${page}&pageSize=15${view ? `&view=${view}` : ''}`),
    refetchInterval: 10_000, placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['social-posts'] });
  const onError = (e: unknown) => toast.show(errorMessage(e));
  const cancel = useMutation({ mutationFn: (id: string) => api(`/social/posts/${id}/cancel`, { method: 'POST' }), onSuccess: () => { refresh(); toast.show('Publicação cancelada.'); }, onError });
  const now = useMutation({ mutationFn: (id: string) => api(`/social/posts/${id}/publish-now`, { method: 'POST' }), onSuccess: () => { refresh(); toast.show('Publicando agora…'); }, onError });
  const retry = useMutation({ mutationFn: (v: { id: string; t: string }) => api(`/social/posts/${v.id}/targets/${v.t}/retry`, { method: 'POST' }), onSuccess: () => { refresh(); toast.show('Reenviando…'); }, onError });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const manage = can('marketing.manage');

  return (
    <>
      <div className="seg" role="tablist" style={{ marginBottom: 16 }}>
        {VIEWS.map(([k, l]) => <button key={k || 'all'} role="tab" className={view === k ? 'active' : ''} onClick={() => { setView(k); setPage(1); }}>{l}</button>)}
      </div>
      <div className="card">
        {q.isLoading ? <SkeletonRows rows={5} /> : !d?.items.length ? (
          <Empty icon={<Share2 />} title={view === 'scheduled' ? 'Nenhuma publicação agendada' : 'Nada por aqui'} hint="No imóvel, use “Publicar nas redes” para criar uma postagem já preenchida." />
        ) : d.items.map((p) => (
          <div key={p.id} className="post-card">
            <div className="post-thumbs">{p.media[0]?.thumbnailUrl ? <img src={p.media[0].thumbnailUrl} alt="" loading="lazy" /> : <div className="noimg" style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--faint)' }}><ImageIcon /></div>}{p.media.length > 1 && <span className="count">{p.media.length} fotos</span>}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone={STATUS_TONE[p.status]}>{SOCIAL_POST_STATUS_LABELS[p.status]}</Badge>
                {p.property && <Link to={`/imoveis/${p.property.id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>{p.property.code} · {p.property.title}</Link>}
              </div>
              <div className="post-caption">{p.caption}</div>
              <div className="card-sub" style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                <CalendarClock size={14} />
                {p.status === 'PUBLISHED' || p.status === 'PARTIAL' ? `Publicada em ${dateTime(p.publishedAt ?? p.scheduledAt)}` : `${p.status === 'CANCELLED' ? 'Estava agendada para' : 'Agendada para'} ${dateTime(p.scheduledAt)}`}{p.createdBy ? ` · ${p.createdBy}` : ''}
              </div>
              <div className="targets">
                {p.targets.map((t) => (
                  <div key={t.id} style={{ display: 'grid', gap: 4 }}>
                    <span className={`target ${t.status === 'PUBLISHED' ? 'ok' : t.status === 'FAILED' ? 'bad' : ''}`}>
                      <Icon provider={t.provider} />{t.accountName}
                      {t.status === 'PUBLISHED' && <>{<Check />}{t.permalink && <a href={t.permalink} target="_blank" rel="noreferrer">ver</a>}</>}
                      {t.status === 'PENDING' && t.attempts > 0 && <span title={t.error ?? ''}>tentativa {t.attempts}/3</span>}
                      {t.status === 'FAILED' && <AlertTriangle />}
                    </span>
                    {t.status === 'FAILED' && (
                      <span className="card-sub" style={{ color: 'var(--danger)', maxWidth: 380 }}>{t.error}{manage && p.status !== 'CANCELLED' && <> · <button type="button" className="btn btn-ghost" style={{ height: 22, padding: '0 6px' }} onClick={() => retry.mutate({ id: p.id, t: t.id })}><RotateCw size={12} /> Reenviar</button></>}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {manage && p.status === 'SCHEDULED' && (
              <div className="post-actions">
                <Button onClick={() => nav(`/redes-sociais/${p.id}`)}>Editar</Button>
                <Button variant="primary" onClick={() => now.mutate(p.id)} disabled={now.isPending}><Send /> Publicar agora</Button>
                <Button variant="ghost" className="btn-danger" onClick={() => confirm('Cancelar esta publicação agendada?') && cancel.mutate(p.id)}>Cancelar</Button>
              </div>
            )}
          </div>
        ))}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>{d.total} publicações · página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
      {toast.node}
    </>
  );
}

function AccountsTab({ status }: { status: string | null }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['social-accounts'], queryFn: () => api<Accounts>('/social/accounts') });
  const [choose, setChoose] = useState(false);
  const s = q.data;
  const manage = can('marketing.manage');

  useEffect(() => { if (s?.pending.length) setChoose(true); }, [s?.pending.length]);
  useEffect(() => {
    const msg = status === 'denied' ? 'Você cancelou o login com o Facebook.' : status === 'error' ? 'Não foi possível concluir o login com o Facebook. Tente novamente.' : status === 'empty' ? 'Nenhuma Página do Facebook foi encontrada nesta conta.' : null;
    if (msg) toast.show(msg);
  }, [status]); // eslint-disable-line

  const [appPick, setAppPick] = useState('');
  const apps = s?.apps ?? [];
  const chosen = apps.some((a) => a.id === appPick) ? appPick : apps[0]?.id;
  const connect = useMutation({
    mutationFn: (appId?: string | null) => api<{ url: string }>('/social/connect', { method: 'POST', body: { appId: appId ?? chosen } }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['social-accounts'] });
  const check = useMutation({ mutationFn: (id: string) => api<{ ok: boolean }>(`/social/accounts/${id}/check`, { method: 'POST' }), onSuccess: (r) => { refresh(); toast.show(r.ok ? 'Conexão ok.' : 'A conexão expirou. Reconecte a conta.'); }, onError: (e) => toast.show(errorMessage(e)) });
  const share = useMutation({ mutationFn: (v: { id: string; shared: boolean }) => api(`/social/accounts/${v.id}/share`, { method: 'PATCH', body: { shared: v.shared } }), onSuccess: (_r, v) => { refresh(); toast.show(v.shared ? 'Conta compartilhada com a equipe.' : 'Conta voltou a ser só sua.'); }, onError: (e) => toast.show(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/social/accounts/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); toast.show('Conta desconectada.'); }, onError: (e) => toast.show(errorMessage(e)) });

  if (q.isLoading) return <div className="card"><SkeletonRows rows={4} /></div>;
  return (
    <>
      {manage && <AppsCard s={s} onSaved={refresh} />}
      <section className="card">
        <div className="card-head">
          <div><div className="card-title">Facebook e Instagram</div><div className="card-sub">Entre com o Facebook e escolha quais Páginas e contas do Instagram usar.</div></div>
          {manage && (
            <div className="toolbar">
              {apps.length > 1 && <Select style={{ width: 200 }} value={chosen} onChange={(e) => setAppPick(e.target.value)} aria-label="Aplicativo da Meta">{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
              <Button variant="primary" onClick={() => connect.mutate(undefined)} disabled={!s?.configured || connect.isPending}><Facebook /> {s?.accounts.length ? 'Conectar mais contas' : 'Entrar com o Facebook'}</Button>
            </div>
          )}
        </div>
        {!s?.accounts.length ? <Empty icon={<Share2 />} title="Nenhuma conta conectada" hint="O Instagram precisa ser uma conta profissional ligada a uma Página do Facebook." /> : s.accounts.map((a) => (
          <div key={a.id} className="acc">
            <div className="acc-pic">{a.pictureUrl ? <img src={a.pictureUrl} alt="" /> : <Icon provider={a.provider} />}</div>
            <div className="acc-info">
              <strong>{a.provider === 'INSTAGRAM' && a.username ? `@${a.username}` : a.name}</strong>
              <span className="card-sub">{SOCIAL_PROVIDER_LABELS[a.provider]}{apps.length > 1 && a.appName ? ` · via ${a.appName}` : ''}{!a.mine && a.ownerName ? ` · de ${a.ownerName}` : ''}{a.linkedPageName ? ` · ligada à Página ${a.linkedPageName}` : ''}</span>
            </div>
            <Badge tone={a.shared ? 'accent' : undefined} plain>{a.shared ? 'Compartilhada' : 'Só você'}</Badge>
            <Badge tone={a.status === 'ACTIVE' ? 'ok' : 'danger'}>{a.status === 'ACTIVE' ? 'Ativa' : 'Expirada'}</Badge>
            {manage && (
              <div className="toolbar">
                {a.mine && <Button variant="ghost" onClick={() => share.mutate({ id: a.id, shared: !a.shared })} disabled={share.isPending}>{a.shared ? 'Parar de compartilhar' : 'Compartilhar com a equipe'}</Button>}
                {a.status === 'EXPIRED' ? (a.mine ? <Button onClick={() => connect.mutate(a.appRef ?? undefined)}>Reconectar</Button> : null) : <Button variant="ghost" onClick={() => check.mutate(a.id)} disabled={check.isPending}>Verificar</Button>}
                {(a.mine || (a.shared && can('admin.company'))) && <Button variant="ghost" className="btn-danger" onClick={() => confirm(`Desconectar ${a.name}? Publicações agendadas só para esta conta serão canceladas.`) && remove.mutate(a.id)}>Desconectar</Button>}
              </div>
            )}
          </div>
        ))}
      </section>
      {choose && s && s.pending.length > 0 && <ChooseModal pending={s.pending} onClose={() => setChoose(false)} onDone={() => { setChoose(false); refresh(); toast.show('Contas conectadas.'); }} />}
      {toast.node}
    </>
  );
}

function ChooseModal({ pending, onClose, onDone }: { pending: SocialAccountDto[]; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (ids: string[]) => api('/social/accounts/activate', { method: 'POST', body: { accountIds: ids } }), onSuccess: onDone, onError: setErr });
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <Modal title="Quais contas você quer usar?" onClose={() => save.mutate([])}
      footer={<><Button onClick={() => save.mutate([])} disabled={save.isPending}>Nenhuma</Button><Button variant="primary" onClick={() => save.mutate(sel)} disabled={!sel.length || save.isPending}>Conectar {sel.length} {sel.length === 1 ? 'conta' : 'contas'}</Button></>}>
      {err != null && <div className="alert" style={{ marginBottom: 12 }}>{errorMessage(err)}</div>}
      <p className="card-sub" style={{ marginBottom: 14 }}>Encontramos estas Páginas e contas do Instagram. Marque só as que vai usar: as que ficarem sem marca são esquecidas e o acesso delas é descartado.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {pending.map((a) => (
          <label key={a.id} className={`acct-opt ${sel.includes(a.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} />
            <div className="acc-pic" style={{ width: 34, height: 34 }}>{a.pictureUrl ? <img src={a.pictureUrl} alt="" /> : <Icon provider={a.provider} />}</div>
            <div><strong style={{ fontWeight: 550 }}>{a.provider === 'INSTAGRAM' && a.username ? `@${a.username}` : a.name}</strong><div className="card-sub">{SOCIAL_PROVIDER_LABELS[a.provider]}{a.linkedPageName ? ` · Página ${a.linkedPageName}` : ''}</div></div>
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** Aplicativos da Meta desta empresa (pode haver vários): o ID e a chave secreta ficam no banco, criptografados. */
function AppsCard({ s, onSaved }: { s: Accounts | undefined; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const apps = s?.apps ?? [];
  const [form, setForm] = useState<{ id: string | null; name: string; appId: string; appSecret: string; shared: boolean } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const editing = form?.id ? apps.find((a) => a.id === form.id) : null;
  const open = (a?: SocialAppDto) => { setErr(null); setForm(a ? { id: a.id, name: a.name, appId: a.appId, appSecret: '', shared: a.shared } : { id: null, name: '', appId: '', appSecret: '', shared: false }); };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form!.name, appId: form!.appId, shared: form!.shared, ...(form!.appSecret && { appSecret: form!.appSecret }) };
      return form!.id ? api(`/social/apps/${form!.id}`, { method: 'PATCH', body }) : api('/social/apps', { method: 'POST', body });
    },
    onSuccess: () => { onSaved(); setForm(null); setErr(null); toast.show('Aplicativo salvo.'); },
    onError: setErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/social/apps/${id}`, { method: 'DELETE' }),
    onSuccess: () => { onSaved(); toast.show('Aplicativo removido.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });

  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <div><div className="card-title">Aplicativos da Meta</div><div className="card-sub">Cada pessoa usa o próprio app e as próprias contas. Só quem cadastrou vê e usa, a menos que compartilhe com a equipe.</div></div>
        <Button variant={apps.length ? 'default' : 'primary'} onClick={() => open()}><Plus /> Adicionar aplicativo</Button>
      </div>
      {apps.length > 0 && apps.map((a) => (
        <div key={a.id} className="acc">
          <div className="acc-info">
            <strong>{a.name}</strong>
            <span className="card-sub">ID {a.appId} · {a.accountCount} {a.accountCount === 1 ? 'conta conectada' : 'contas conectadas'}{a.source === 'server' ? ' · configurado no servidor' : !a.mine && a.ownerName ? ` · de ${a.ownerName}` : ''}</span>
          </div>
          {a.source === 'company' && <Badge tone={a.shared ? 'accent' : undefined} plain>{a.shared ? 'Compartilhado' : 'Só você'}</Badge>}
          {a.source === 'company' && (a.mine || (a.shared && can('admin.company'))) && (
            <div className="toolbar">
              <Button variant="ghost" onClick={() => open(a)}>Editar</Button>
              <Button variant="ghost" className="btn-danger" onClick={() => confirm(`Remover “${a.name}”? As contas já conectadas continuam publicando, mas novos logins por este app deixam de funcionar.`) && remove.mutate(a.id)}>Remover</Button>
            </div>
          )}
        </div>
      ))}
      {!apps.length && !form && (
        <div className="section-body"><div className="card-sub">Nenhum aplicativo cadastrado. Adicione o primeiro para poder entrar com o Facebook.</div></div>
      )}
      {form && (
        <form className="section-body" style={{ borderTop: apps.length ? '1px solid var(--line)' : undefined }} onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); }}>
          <ol className="steps-list">
            <li>Em <strong>developers.facebook.com</strong>, crie um aplicativo do tipo <em>Empresa</em> e adicione o produto <strong>Login do Facebook</strong>.</li>
            <li>Em “URIs de redirecionamento do OAuth válidos”, cadastre: <code style={{ overflowWrap: 'anywhere' }}>{s?.redirectUri}</code></li>
            <li>Em <em>Configurações → Básico</em>, copie o <strong>ID do app</strong> e a <strong>chave secreta</strong> e cole abaixo.</li>
            <li>Enquanto o app estiver em <em>modo de desenvolvimento</em>, só quem tem função no app consegue entrar. Para liberar a todos, envie o app para <strong>revisão da Meta</strong>.</li>
          </ol>
          {err != null && !Object.keys(fe).length && <div className="alert" style={{ margin: '12px 0' }}>{errorMessage(err)}</div>}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Nome" error={fe.name} className="span-2" hint="Só para você reconhecer, ex.: “App da matriz” ou “App do João”."><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} /></Field>
            <Field label="ID do app" error={fe.appId} hint="Só números, no topo das configurações do app."><Input required inputMode="numeric" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} placeholder="123456789012345" /></Field>
            <Field label="Chave secreta do app" error={fe.appSecret} hint={editing ? 'Já salva. Preencha somente para trocar.' : 'Fica criptografada e nunca é exibida de volta.'}>
              <Input type="password" autoComplete="off" required={!editing} value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} placeholder={editing ? '•••••••• (salva)' : ''} />
            </Field>
          </div>
          <label className="check" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13.5 }}>
            <input type="checkbox" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} /> Compartilhar com a equipe <span className="card-sub">(os colegas poderão conectar contas por este app)</span>
          </label>
          <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <Button type="button" variant="ghost" onClick={() => { setForm(null); setErr(null); }}>Cancelar</Button>
            <Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Validando com a Meta…' : 'Salvar aplicativo'}</Button>
          </div>
        </form>
      )}
      {toast.node}
    </section>
  );
}
