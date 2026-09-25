import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, MessageCircle, Plug } from 'lucide-react';
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

      <section className="card" style={{ marginTop: 20, opacity: .75 }}>
        <div className="card-head"><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="brand-mark" style={{ background: 'var(--line-strong)', color: 'var(--ink-2)' }}><Plug /></div><div><div className="card-title">Meta Conversions API e Pixel</div><div className="card-sub">Envie leads qualificados de volta aos anúncios.</div></div></div><Badge plain>Em breve</Badge></div>
      </section>
      {toast.node}
    </>
  );
}
