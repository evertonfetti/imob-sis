import { INSTAGRAM_CAPTION_MAX, INSTAGRAM_CAROUSEL_MAX, SOCIAL_PROVIDER_LABELS, type SocialAccountDto, type SocialPostDto } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Facebook, Instagram, RotateCcw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SearchPicker } from '../components/SearchPicker';
import { searchProperties } from '../components/crm';
import { Button, Field, Input, Select, SkeletonRows, errorMessage, fieldErrors } from '../components/ui';
import { api } from '../lib/api';
import { toLocalInput } from '../lib/format';

interface Composer {
  property: { id: string; code: string; title: string; slug: string; published: boolean };
  caption: string;
  media: { id: string; isCover: boolean; thumbnailUrl: string | null; url: string | null }[];
}
const Icon = ({ provider }: { provider: string }) => (provider === 'INSTAGRAM' ? <Instagram size={18} /> : <Facebook size={18} />);

/** "Hoje 18:00" / "Amanhã 09:00" etc., no fuso do navegador. */
function quick(daysAhead: number, hour: number) {
  const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0);
  return d.getTime() > Date.now() ? toLocalInput(d.toISOString()) : null;
}

export function SocialComposer() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const editing = !!id;
  const existing = useQuery({ queryKey: ['social-post', id], enabled: editing, queryFn: () => api<SocialPostDto>(`/social/posts/${id}`) });
  const [propertyId, setPropertyId] = useState<string | null>(sp.get('imovel'));
  const [pick, setPick] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const pid = editing ? existing.data?.propertyId ?? null : propertyId;

  const composer = useQuery({ queryKey: ['social-composer', pid], enabled: !!pid, queryFn: () => api<Composer>(`/social/composer/${pid}`) });
  const accounts = useQuery({ queryKey: ['social-accounts'], queryFn: () => api<{ accounts: SocialAccountDto[] }>('/social/accounts') });

  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [when, setWhen] = useState('');
  const [now, setNow] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);

  // Tudo já vem preenchido: fotos (capa primeiro), contas ativas e o texto padrão. Falta só a data.
  useEffect(() => {
    if (ready || !composer.data || !accounts.data) return;
    if (editing) {
      if (!existing.data) return;
      setMediaIds(existing.data.media.map((m) => m.id)); setAccountIds(existing.data.targets.map((t) => t.accountId));
      setCaption(existing.data.caption); setWhen(toLocalInput(existing.data.scheduledAt));
    } else {
      setMediaIds(composer.data.media.slice(0, INSTAGRAM_CAROUSEL_MAX).map((m) => m.id));
      setAccountIds(accounts.data.accounts.filter((a) => a.status === 'ACTIVE').map((a) => a.id));
      setCaption(composer.data.caption);
    }
    setReady(true);
  }, [composer.data, accounts.data, existing.data, editing, ready]);

  const active = accounts.data?.accounts.filter((a) => a.status === 'ACTIVE') ?? [];
  const hasIg = active.some((a) => accountIds.includes(a.id) && a.provider === 'INSTAGRAM');
  const locked = editing && !!existing.data && existing.data.status !== 'SCHEDULED';
  const over = hasIg && caption.length > INSTAGRAM_CAPTION_MAX;

  const save = useMutation({
    mutationFn: () => {
      const body = { mediaIds, caption, accountIds, scheduledAt: now ? null : new Date(when).toISOString() };
      return editing ? api(`/social/posts/${id}`, { method: 'PATCH', body }) : api('/social/posts', { method: 'POST', body: { ...body, propertyId: pid } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-posts'] }); nav('/redes-sociais'); },
    onError: setErr,
  });

  const toggleMedia = (mid: string) => setMediaIds(mediaIds.includes(mid) ? mediaIds.filter((x) => x !== mid) : mediaIds.length >= INSTAGRAM_CAROUSEL_MAX ? mediaIds : [...mediaIds, mid]);
  const toggleAcc = (aid: string) => setAccountIds(accountIds.includes(aid) ? accountIds.filter((x) => x !== aid) : [...accountIds, aid]);
  const canSubmit = !!mediaIds.length && !!accountIds.length && !!caption.trim() && !over && (now || !!when) && !save.isPending && !locked;
  const first = composer.data?.media.find((m) => m.id === mediaIds[0]);
  const igAccount = active.find((a) => a.provider === 'INSTAGRAM' && accountIds.includes(a.id));

  return (
    <>
      <Link to="/redes-sociais" className="backlink"><ArrowLeft /> Redes sociais</Link>
      <div className="page-head"><div><h1 className="page-title">{editing ? 'Editar publicação' : 'Nova publicação'}</h1>
        {composer.data && <p className="page-sub">{composer.data.property.code} · {composer.data.property.title}</p>}</div></div>

      {!pid ? (
        <div className="card card-pad" style={{ maxWidth: 560 }}>
          <Field label="Qual imóvel você quer divulgar?" hint="As fotos e o texto do imóvel já vêm prontos na próxima etapa.">
            <SearchPicker queryKey="pick-property-social" value={pick} onChange={(o) => { setPick(o); if (o) setPropertyId(o.id); }} search={searchProperties} placeholder="Buscar por código, título ou bairro…" />
          </Field>
        </div>
      ) : composer.isLoading || accounts.isLoading ? <div className="card"><SkeletonRows rows={8} /></div> : composer.error ? <div className="alert">{errorMessage(composer.error)}</div> : (
        <>
          {!active.length && <div className="alert" style={{ marginBottom: 16 }}>Nenhuma conta conectada. <Link to="/redes-sociais?aba=contas" style={{ textDecoration: 'underline' }}>Conecte o Facebook/Instagram</Link> para publicar.</div>}
          {locked && <div className="alert" style={{ marginBottom: 16 }}>Esta publicação já foi enviada e não pode mais ser alterada.</div>}
          {err != null && !Object.keys(fe).length && <div className="alert" style={{ marginBottom: 16 }}>{errorMessage(err)}</div>}
          <div className="compose">
            <div className="stack">
              <section className="card">
                <div className="card-head"><div><div className="section-title">Fotos</div><div className="section-desc">{mediaIds.length} de {INSTAGRAM_CAROUSEL_MAX} · a primeira é a capa da publicação</div></div>
                  <div className="toolbar"><Button type="button" variant="ghost" onClick={() => setMediaIds(composer.data!.media.slice(0, INSTAGRAM_CAROUSEL_MAX).map((m) => m.id))}>Selecionar todas</Button><Button type="button" variant="ghost" onClick={() => setMediaIds([])}>Limpar</Button></div></div>
                <div className="section-body">
                  {!composer.data!.media.length ? <div className="card-sub">Este imóvel ainda não tem fotos processadas.</div> : (
                    <div className="pick-grid">
                      {composer.data!.media.map((m) => {
                        const i = mediaIds.indexOf(m.id);
                        return (
                          <button type="button" key={m.id} className={`pick ${i >= 0 ? 'on' : ''}`} onClick={() => toggleMedia(m.id)} aria-pressed={i >= 0} aria-label={`Foto ${i >= 0 ? `número ${i + 1}` : 'não selecionada'}`}>
                            {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" loading="lazy" />}
                            {i >= 0 && <span className="num">{i + 1}</span>}{m.isCover && <span className="cov">Capa</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {fe.mediaIds && <div className="field-error" style={{ marginTop: 8 }}>{fe.mediaIds}</div>}
                </div>
              </section>

              <section className="card">
                <div className="card-head"><div><div className="section-title">Texto</div><div className="section-desc">Já vem com a descrição do imóvel. Edite à vontade.</div></div>
                  {composer.data && <Button type="button" variant="ghost" onClick={() => setCaption(composer.data!.caption)}><RotateCcw /> Restaurar padrão</Button>}</div>
                <div className="section-body">
                  <textarea className="input textarea" style={{ minHeight: 260 }} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={locked} aria-label="Texto da publicação" />
                  <div className={`counter ${over ? 'over' : ''}`}>{caption.length}{hasIg ? ` / ${INSTAGRAM_CAPTION_MAX}` : ''} caracteres{over ? ' — o Instagram aceita até 2.200' : ''}</div>
                  {fe.caption && <div className="field-error">{fe.caption}</div>}
                </div>
              </section>
            </div>

            <aside className="aside stack">
              <section className="card">
                <div className="card-head"><div className="section-title">Onde publicar</div></div>
                <div className="section-body" style={{ display: 'grid', gap: 8 }}>
                  {active.map((a) => (
                    <label key={a.id} className={`acct-opt ${accountIds.includes(a.id) ? 'on' : ''}`}>
                      <input type="checkbox" checked={accountIds.includes(a.id)} onChange={() => toggleAcc(a.id)} disabled={locked} />
                      <Icon provider={a.provider} />
                      <div><strong style={{ fontWeight: 550 }}>{a.provider === 'INSTAGRAM' && a.username ? `@${a.username}` : a.name}</strong><div className="card-sub">{SOCIAL_PROVIDER_LABELS[a.provider]}</div></div>
                    </label>
                  ))}
                  {fe.accountIds && <div className="field-error">{fe.accountIds}</div>}
                </div>
              </section>

              <section className="card">
                <div className="card-head"><div className="section-title">Quando</div></div>
                <div className="section-body" style={{ display: 'grid', gap: 12 }}>
                  <Select value={now ? 'now' : 'later'} onChange={(e) => setNow(e.target.value === 'now')} disabled={locked} aria-label="Quando publicar"><option value="later">Agendar para uma data</option><option value="now">Publicar agora</option></Select>
                  {!now && (
                    <Field label="Data e hora" error={fe.scheduledAt}>
                      <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={locked} autoFocus={!editing} />
                      <div className="quick">
                        {([['Hoje 18h', 0, 18], ['Amanhã 9h', 1, 9], ['Amanhã 12h', 1, 12], ['Amanhã 18h', 1, 18]] as const).map(([l, d, h]) => {
                          const v = quick(d, h);
                          return v ? <button type="button" key={l} className="chip" onClick={() => setWhen(v)}>{l}</button> : null;
                        })}
                      </div>
                    </Field>
                  )}
                  <Button variant="primary" block disabled={!canSubmit} onClick={() => { setErr(null); save.mutate(); }}><Send /> {save.isPending ? 'Enviando…' : now ? 'Publicar agora' : editing ? 'Salvar alterações' : 'Agendar publicação'}</Button>
                  {!now && !when && <div className="card-sub">Falta só escolher a data.</div>}
                </div>
              </section>

              <section className="preview" aria-label="Pré-visualização">
                <div className="preview-head"><Instagram size={16} /> {igAccount?.username ? `@${igAccount.username}` : 'Pré-visualização'}</div>
                {first?.url ? <img src={first.url} alt="" /> : <div style={{ aspectRatio: '1', background: 'var(--surface-2)' }} />}
                <div className="preview-cap">{caption || 'O texto aparece aqui.'}</div>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
