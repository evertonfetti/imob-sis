import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, MessageCircle, Plug } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Field, Input, PageHeader, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { api } from '../lib/api';

interface Status {
  connected: boolean; phoneNumberId: string | null; wabaId: string | null; displayPhone: string | null; verifiedName: string | null; qualityRating: string | null;
  accessTokenSet: boolean; appSecretSet: boolean; verifyToken: string | null; webhookUrl: string;
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="copy">
        <code>{value}</code>
        <Button type="button" onClick={async () => { await navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }} aria-label={`Copiar ${label}`}>{done ? <Check /> : <Copy />}{done ? 'Copiado' : 'Copiar'}</Button>
      </div>
    </div>
  );
}

export function Integrations() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['integration-wa'], queryFn: () => api<Status>('/integrations/whatsapp') });
  const [f, setF] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '' });
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const s = q.data;
  const value = (k: keyof typeof f) => (touched ? f[k] : k === 'phoneNumberId' ? (s?.phoneNumberId ?? '') : k === 'wabaId' ? (s?.wabaId ?? '') : f[k]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setTouched(true); setF({ phoneNumberId: value('phoneNumberId'), wabaId: value('wabaId'), accessToken: f.accessToken, appSecret: f.appSecret, [k]: e.target.value }); };

  const save = useMutation({
    mutationFn: () => api('/integrations/whatsapp', {
      method: 'PUT',
      body: { phoneNumberId: value('phoneNumberId') || undefined, wabaId: value('wabaId') || undefined, ...(f.accessToken && { accessToken: f.accessToken }), ...(f.appSecret && { appSecret: f.appSecret }) },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integration-wa'] }); setF({ ...f, accessToken: '', appSecret: '' }); setErr(null); toast.show('Credenciais salvas.'); },
    onError: setErr,
  });
  const test = useMutation({
    mutationFn: () => api<{ displayPhone: string | null; verifiedName: string | null }>('/integrations/whatsapp/test', { method: 'POST' }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['integration-wa'] }); toast.show(`Conexão ok${r.verifiedName ? `: ${r.verifiedName}` : ''}`); },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api('/integrations/whatsapp', { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integration-wa'] }); setTouched(false); setF({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '' }); toast.show('WhatsApp desconectado.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); };

  return (
    <>
      <PageHeader title="Integrações" subtitle="Conecte a imobiliária aos canais e ferramentas que ela usa." />
      {q.isLoading ? <div className="card"><SkeletonRows rows={6} /></div> : (
        <div className="two-col" style={{ alignItems: 'start' }}>
          <section className="card">
            <div className="card-head">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="brand-mark" style={{ background: '#25553f' }}><MessageCircle /></div>
                <div><div className="card-title">WhatsApp Business (API oficial da Meta)</div><div className="card-sub">Receba e responda mensagens dentro do CRM.</div></div>
              </div>
              <Badge tone={s?.connected ? 'ok' : undefined}>{s?.connected ? 'Conectado' : 'Não conectado'}</Badge>
            </div>
            <form className="section-body" onSubmit={submit}>
              {err != null && !Object.keys(fe).length && <div className="alert" style={{ marginBottom: 16 }}>{errorMessage(err)}</div>}
              {s?.connected && (
                <div className="kvrow" style={{ marginBottom: 12 }}><span>Número conectado</span><span>{s.displayPhone ? `${s.displayPhone}${s.verifiedName ? ` · ${s.verifiedName}` : ''}` : 'Clique em “Testar conexão” para confirmar'}</span></div>
              )}
              <div className="form-grid">
                <Field label="ID do número de telefone" error={fe.phoneNumberId} hint="Na Meta: WhatsApp → Configuração da API."><Input required inputMode="numeric" value={value('phoneNumberId')} onChange={set('phoneNumberId')} placeholder="123456789012345" /></Field>
                <Field label="ID da conta do WhatsApp (opcional)" error={fe.wabaId}><Input inputMode="numeric" value={value('wabaId')} onChange={set('wabaId')} /></Field>
                <Field label="Token de acesso permanente" className="span-2" error={fe.accessToken} hint={s?.accessTokenSet ? 'Já salvo. Preencha somente para trocar.' : 'Gerado em Usuários do sistema, na Meta. Fica criptografado.'}>
                  <Input type="password" autoComplete="off" required={!s?.accessTokenSet} value={f.accessToken} onChange={set('accessToken')} placeholder={s?.accessTokenSet ? '•••••••• (salvo)' : 'EAAG…'} />
                </Field>
                <Field label="Segredo do app" className="span-2" error={fe.appSecret} hint={s?.appSecretSet ? 'Já salvo. Preencha somente para trocar.' : 'Meta → Configurações do app → Básico. Usado para validar que as mensagens vêm mesmo da Meta.'}>
                  <Input type="password" autoComplete="off" required={!s?.appSecretSet} value={f.appSecret} onChange={set('appSecret')} placeholder={s?.appSecretSet ? '•••••••• (salvo)' : ''} />
                </Field>
              </div>
              <div className="toolbar" style={{ justifyContent: 'space-between', marginTop: 22 }}>
                <div className="toolbar">
                  {s?.connected && <Button type="button" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? 'Testando…' : 'Testar conexão'}</Button>}
                  {s?.connected && <Button type="button" variant="danger" onClick={() => confirm('Desconectar o WhatsApp? As conversas e o histórico continuam salvos, mas novas mensagens deixam de chegar.') && remove.mutate()}>Desconectar</Button>}
                </div>
                <Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Salvando…' : s?.connected ? 'Salvar alterações' : 'Conectar'}</Button>
              </div>
            </form>
          </section>

          <section className="card">
            <div className="card-head"><div className="card-title">Como configurar na Meta</div></div>
            <div className="section-body" style={{ display: 'grid', gap: 16 }}>
              <ol className="steps-list">
                <li>Em <strong>developers.facebook.com</strong>, crie um app do tipo <em>Empresa</em> e adicione o produto <strong>WhatsApp</strong>.</li>
                <li>Copie o <strong>ID do número de telefone</strong> e gere um <strong>token permanente</strong> (usuário do sistema, permissão <code>whatsapp_business_messaging</code>).</li>
                <li>Copie o <strong>segredo do app</strong> e preencha os campos ao lado.</li>
                <li>Em WhatsApp → Configuração → <strong>Webhook</strong>, informe a URL e o token abaixo e assine o campo <code>messages</code>.</li>
              </ol>
              {s?.verifyToken ? (
                <>
                  <CopyField label="URL de retorno (Callback URL)" value={s.webhookUrl} />
                  <CopyField label="Token de verificação" value={s.verifyToken} />
                </>
              ) : <div className="card-sub">Depois de conectar, a URL do webhook e o token de verificação aparecem aqui.</div>}
              <div className="card-sub">Fora da janela de 24 horas após a última mensagem do cliente, o WhatsApp só aceita <strong>modelos de mensagem aprovados</strong> (criados na Meta).</div>
            </div>
          </section>
        </div>
      )}

      {can('marketing.capi') && <MetaCard />}
      {toast.node}
    </>
  );
}

interface PixelRow { id: string; pixelId: string; name: string | null; active: boolean; testEventCode: string | null; accessTokenSet: boolean }
interface MetaStatus { connected: boolean; pixels: PixelRow[] }
interface PixelMonitor {
  id: string; pixelId: string; name: string | null; active: boolean;
  lastFiredTime: string | null; isUnavailable: boolean | null; metaError: string | null;
  stats: { event: string; total: number }[] | null; statsError: string | null; sources: { browser: number; server: number } | null;
  sent24h: { sent: number; failed: number; pending: number }; lastError: string | null;
}

const ago = (iso: string | null) => {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'agora há pouco' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)`;
};

function PixelItem({ px, mon }: { px: PixelRow; mon?: PixelMonitor }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: px.name ?? '', testEventCode: px.testEventCode ?? '', accessToken: '' });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['integration-meta'] }); qc.invalidateQueries({ queryKey: ['integration-meta-monitor'] }); };
  const save = useMutation({
    mutationFn: (body: object) => api(`/marketing/integrations/meta/pixels/${px.id}`, { method: 'PUT', body }),
    onSuccess: () => { refresh(); setEdit(false); setErr(null); setF((v) => ({ ...v, accessToken: '' })); toast.show('Pixel atualizado.'); },
    onError: setErr,
  });
  const test = useMutation({
    mutationFn: () => api<{ pixelName: string | null; readable: boolean }>(`/marketing/integrations/meta/pixels/${px.id}/test`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      toast.show(r.readable ? `Token ok${r.pixelName ? `: ${r.pixelName}` : ''}` : 'A Meta aceitou o token, mas ele não tem permissão de leitura (comum em tokens do Gerenciador de Eventos). Isso não impede o envio: para validar, informe o código de teste e use “Evento de teste”.');
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const testEvent = useMutation({
    mutationFn: () => api<{ eventsReceived: number }>(`/marketing/integrations/meta/pixels/${px.id}/test-event`, { method: 'POST' }),
    onSuccess: (r) => toast.show(`Evento de teste enviado (${r.eventsReceived} recebido). Confira em "Testar eventos" na Meta.`),
    onError: (e) => toast.show(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/marketing/integrations/meta/pixels/${px.id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); toast.show('Pixel removido.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });

  const last = ago(mon?.lastFiredTime ?? null);
  const stale = mon?.lastFiredTime ? Date.now() - new Date(mon.lastFiredTime).getTime() > 24 * 3600_000 : false;
  const src = mon?.sources;
  const total = src ? src.browser + src.server : 0;
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '14px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong>{px.name ?? 'Pixel'}</strong> <span className="mono">{px.pixelId}</span>
          <div className="card-sub">{px.testEventCode ? `Código de teste: ${px.testEventCode}` : 'Sem código de teste'}</div>
        </div>
        <div className="toolbar">
          <Badge tone={px.active ? 'ok' : undefined}>{px.active ? 'Ativo' : 'Desativado'}</Badge>
          <Button type="button" onClick={() => test.mutate()} disabled={test.isPending}>Testar token</Button>
          {px.testEventCode && <Button type="button" onClick={() => testEvent.mutate()} disabled={testEvent.isPending}>Evento de teste</Button>}
          <Button type="button" onClick={() => save.mutate({ active: !px.active })} disabled={save.isPending}>{px.active ? 'Desativar' : 'Ativar'}</Button>
          <Button type="button" onClick={() => setEdit((v) => !v)}>{edit ? 'Fechar' : 'Editar'}</Button>
          <Button type="button" variant="danger" onClick={() => confirm(`Remover o Pixel ${px.pixelId}? Ele some do site e deixa de receber eventos. O histórico é mantido.`) && remove.mutate()}>Remover</Button>
        </div>
      </div>

      {mon && (
        <div className="kv" style={{ marginTop: 10 }}>
          <div className="kvrow"><span>Último disparo na Meta</span><span>{mon.metaError ? <span style={{ color: 'var(--danger)' }}>{mon.metaError}</span> : last ? <>{last} {stale && <Badge tone="warn">parado há mais de 24 h</Badge>}</> : 'Nenhum disparo registrado'}</span></div>
          {mon.isUnavailable && <div className="kvrow"><span>Estado</span><Badge tone="danger">Pixel indisponível na Meta</Badge></div>}
          <div className="kvrow"><span>Enviados pelo sistema (24 h)</span><span>{mon.sent24h.sent} enviados{mon.sent24h.failed > 0 && <> · <span style={{ color: 'var(--danger)' }}>{mon.sent24h.failed} com falha</span></>}{mon.sent24h.pending > 0 && <> · {mon.sent24h.pending} na fila</>}</span></div>
          {mon.lastError && mon.sent24h.failed > 0 && <div className="kvrow"><span>Último erro</span><span style={{ color: 'var(--danger)' }}>{mon.lastError}</span></div>}
          {mon.statsError ? (
            <div className="kvrow"><span>Eventos recebidos (24 h)</span><span className="card-sub" style={{ maxWidth: 420, textAlign: 'right' }}>Este token não permite ler estatísticas: {mon.statsError}</span></div>
          ) : (
            <>
              <div className="kvrow"><span>Origem dos eventos (24 h)</span><span>{src && total > 0 ? `Navegador ${src.browser} · Servidor ${src.server}${src.server === 0 ? ' — sem eventos do servidor' : src.browser === 0 ? ' — sem eventos do navegador' : ''}` : 'Sem eventos'}</span></div>
              <div className="kvrow"><span>Eventos recebidos (24 h)</span><span style={{ textAlign: 'right' }}>{mon.stats?.length ? mon.stats.slice(0, 8).map((s) => `${s.event} ${s.total}`).join(' · ') : 'Nenhum'}</span></div>
            </>
          )}
        </div>
      )}

      {edit && (
        <form className="form-grid" style={{ marginTop: 12 }} onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate({ name: f.name, testEventCode: f.testEventCode, ...(f.accessToken && { accessToken: f.accessToken }) }); }}>
          <Field label="Apelido" error={fe.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Pixel principal" /></Field>
          <Field label="Código de teste (opcional)" hint="Aba “Testar eventos”, ex.: TEST12345."><Input value={f.testEventCode} onChange={(e) => setF({ ...f, testEventCode: e.target.value })} /></Field>
          <Field label="Token deste Pixel" className="span-2" error={fe.accessToken} hint="Já salvo. Preencha somente para trocar.">
            <Input type="password" autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} placeholder="•••••••• (salvo)" />
          </Field>
          <div className="span-2"><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></div>
        </form>
      )}
      {toast.node}
    </div>
  );
}

function MetaCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['integration-meta'], queryFn: () => api<MetaStatus>('/marketing/integrations/meta') });
  // A leitura na Meta é mais lenta que o cadastro: carrega à parte e atualiza a cada 2 min.
  const mon = useQuery({ queryKey: ['integration-meta-monitor'], queryFn: () => api<PixelMonitor[]>('/marketing/integrations/meta/monitor'), enabled: !!q.data?.pixels.length, refetchInterval: 120_000 });
  const s = q.data;
  const [f, setF] = useState({ pixelId: '', accessToken: '', name: '', testEventCode: '' });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);
  const add = useMutation({
    mutationFn: () => api('/marketing/integrations/meta/pixels', { method: 'POST', body: { pixelId: f.pixelId, accessToken: f.accessToken, name: f.name, testEventCode: f.testEventCode } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['integration-meta'] }); qc.invalidateQueries({ queryKey: ['integration-meta-monitor'] }); setF({ pixelId: '', accessToken: '', name: '', testEventCode: '' }); setErr(null); toast.show('Pixel adicionado.'); },
    onError: setErr,
  });

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="card-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="brand-mark" style={{ background: '#2f5d86' }}><Plug /></div>
          <div><div className="card-title">Meta Pixels e Conversions API</div><div className="card-sub">Você pode ter vários Pixels ativos ao mesmo tempo. Cada um tem o seu token, e cada conversão vai a todos com o mesmo identificador, para a Meta contar uma vez só.</div></div>
        </div>
        <Badge tone={s?.connected ? 'ok' : undefined}>{s?.connected ? `${s.pixels.filter((p) => p.active).length} ativo(s)` : 'Não conectado'}</Badge>
      </div>
      <div className="section-body">
        {q.isLoading ? <SkeletonRows rows={3} /> : (
          <>
            {s?.pixels.map((px) => <PixelItem key={px.id} px={px} mon={mon.data?.find((m) => m.id === px.id)} />)}
            {!!s?.pixels.length && mon.isLoading && <div className="card-sub" style={{ marginBottom: 8 }}>Consultando a Meta…</div>}
            <form style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }} onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); add.mutate(); }}>
              <div className="card-title" style={{ marginBottom: 10 }}>Adicionar Pixel</div>
              {err != null && !Object.keys(fe).length && <div className="alert" style={{ marginBottom: 12 }}>{errorMessage(err)}</div>}
              <div className="form-grid">
                <Field label="ID do Pixel (conjunto de dados)" error={fe.pixelId} hint="Gerenciador de Eventos → Fontes de dados."><Input required inputMode="numeric" value={f.pixelId} onChange={(e) => setF({ ...f, pixelId: e.target.value })} placeholder="123456789012345" /></Field>
                <Field label="Apelido (opcional)" error={fe.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Pixel principal" /></Field>
                <Field label="Token de acesso da Conversions API deste Pixel" className="span-2" error={fe.accessToken} hint="Gerado nas configurações do conjunto de dados. Fica criptografado e nunca é exibido de volta.">
                  <Input type="password" autoComplete="off" required value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} placeholder="EAAG…" />
                </Field>
                <Field label="Código de teste (opcional)" hint="Aba “Testar eventos”, ex.: TEST12345. Usado só no botão “Evento de teste”."><Input value={f.testEventCode} onChange={(e) => setF({ ...f, testEventCode: e.target.value })} /></Field>
              </div>
              <p className="card-sub" style={{ marginTop: 14 }}>Privacidade: e-mail e telefone vão sempre com <strong>hash</strong> (SHA-256), e só de visitantes que <strong>aceitaram</strong> o aviso de cookies do site. O Pixel só é carregado após esse aceite, e acessos da equipe (painel, subdomínios) ficam de fora.</p>
              <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <Button variant="primary" disabled={add.isPending}>{add.isPending ? 'Adicionando…' : 'Adicionar Pixel'}</Button>
              </div>
            </form>
          </>
        )}
      </div>
      {toast.node}
    </section>
  );
}
