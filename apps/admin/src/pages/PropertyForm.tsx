import {
  PROPERTY_PURPOSES, PROPERTY_STATUSES, PURPOSE_LABELS, STATUS_LABELS,
  type PropertyPurpose, type PropertyStatus,
} from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Images, Share2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Field, Input, Select, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { MoneyInput } from '../lib/money';
import { Gallery } from '../components/Gallery';
import { PropertyMatches } from '../components/intelligence';
import { OwnerModal, type Owner } from './Owners';
import { statusBadge } from './Properties';

interface Form {
  title: string; shortDescription: string; description: string; purpose: PropertyPurpose; typeId: string; subtype: string;
  status: PropertyStatus; ownerId: string; brokerId: string; branchId: string;
  salePrice: number | null; rentPrice: number | null; condominiumFee: number | null; propertyTax: number | null; minimumNegotiationPrice: number | null;
  bedrooms: string; suites: string; bathrooms: string; parkingSpaces: string;
  totalArea: string; usefulArea: string; builtArea: string; landArea: string;
  zipCode: string; address: string; number: string; complement: string; neighborhood: string; city: string; state: string;
  showExactAddress: boolean; featured: boolean; featureIds: string[];
}

const EMPTY: Form = {
  title: '', shortDescription: '', description: '', purpose: 'SALE', typeId: '', subtype: '', status: 'DRAFT', ownerId: '', brokerId: '', branchId: '',
  salePrice: null, rentPrice: null, condominiumFee: null, propertyTax: null, minimumNegotiationPrice: null,
  bedrooms: '', suites: '', bathrooms: '', parkingSpaces: '', totalArea: '', usefulArea: '', builtArea: '', landArea: '',
  zipCode: '', address: '', number: '', complement: '', neighborhood: '', city: '', state: '',
  showExactAddress: false, featured: false, featureIds: [],
};

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const t = (v: string) => (v.trim() === '' ? null : v.trim());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromApi = (p: any): Form => ({
  ...EMPTY,
  title: p.title, shortDescription: s(p.shortDescription), description: s(p.description), purpose: p.purpose, typeId: p.typeId, subtype: s(p.subtype),
  status: p.status, ownerId: s(p.ownerId), brokerId: s(p.brokerId), branchId: s(p.branchId),
  salePrice: p.salePrice, rentPrice: p.rentPrice, condominiumFee: p.condominiumFee, propertyTax: p.propertyTax, minimumNegotiationPrice: p.minimumNegotiationPrice ?? null,
  bedrooms: s(p.bedrooms), suites: s(p.suites), bathrooms: s(p.bathrooms), parkingSpaces: s(p.parkingSpaces),
  totalArea: s(p.totalArea), usefulArea: s(p.usefulArea), builtArea: s(p.builtArea), landArea: s(p.landArea),
  zipCode: s(p.zipCode), address: s(p.address), number: s(p.number), complement: s(p.complement), neighborhood: s(p.neighborhood), city: s(p.city), state: s(p.state),
  showExactAddress: p.showExactAddress, featured: p.featured, featureIds: p.features.map((f: { id: string }) => f.id),
});

const toApi = (f: Form, canEdit: boolean) => ({
  title: f.title.trim(), shortDescription: t(f.shortDescription), description: t(f.description), purpose: f.purpose, typeId: f.typeId, subtype: t(f.subtype),
  status: f.status, ...(canEdit && { ownerId: f.ownerId || null }), brokerId: f.brokerId || null, branchId: f.branchId || null,
  salePrice: f.purpose === 'RENT' ? null : f.salePrice, rentPrice: f.purpose === 'SALE' ? null : f.rentPrice,
  condominiumFee: f.condominiumFee, propertyTax: f.propertyTax, ...(canEdit && { minimumNegotiationPrice: f.purpose === 'RENT' ? null : f.minimumNegotiationPrice }),
  bedrooms: n(f.bedrooms), suites: n(f.suites), bathrooms: n(f.bathrooms), parkingSpaces: n(f.parkingSpaces),
  totalArea: n(f.totalArea), usefulArea: n(f.usefulArea), builtArea: n(f.builtArea), landArea: n(f.landArea),
  zipCode: t(f.zipCode), address: t(f.address), number: t(f.number), complement: t(f.complement),
  neighborhood: t(f.neighborhood), city: t(f.city), state: t(f.state)?.toUpperCase() ?? null,
  showExactAddress: f.showExactAddress, featured: f.featured, featureIds: f.featureIds,
});

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head"><div><div className="section-title">{title}</div>{desc && <div className="section-desc">{desc}</div>}</div></div>
      <div className="section-body">{children}</div>
    </section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'Cadastrado', UPDATE: 'Alterado', PUBLISH: 'Publicado', UNPUBLISH: 'Despublicado', ARCHIVE: 'Arquivado',
  SOCIAL_PUBLISHED: 'Publicado nas redes', MEDIA_ADDED: 'Arquivo adicionado', MEDIA_REMOVED: 'Arquivo removido', COVER_CHANGED: 'Capa alterada',
};

export function PropertyForm() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const toast = useToast();
  const canEdit = can('property.edit');
  const readOnly = isNew ? !can('property.create') : !canEdit;

  const [f, setF] = useState<Form>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ownerModal, setOwnerModal] = useState(false);

  const prop = useQuery({ queryKey: ['property', id], enabled: !isNew, queryFn: () => api<any>(`/properties/${id}`) });
  const types = useQuery({ queryKey: ['types'], queryFn: () => api<{ id: string; name: string; active: boolean }[]>('/property-types') });
  const features = useQuery({ queryKey: ['features'], queryFn: () => api<{ id: string; name: string; category: string | null; active: boolean }[]>('/features') });
  const options = useQuery({ queryKey: ['prop-options'], queryFn: () => api<{ brokers: { id: string; name: string }[] }>('/properties/options') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name: string; active: boolean }[]>('/branches') });
  const owners = useQuery({ queryKey: ['owners', 'all'], enabled: canEdit, queryFn: () => api<{ items: Owner[] }>('/owners?pageSize=100') });
  const history = useQuery({ queryKey: ['property-history', id], enabled: !isNew && canEdit, queryFn: () => api<any[]>(`/properties/${id}/history`) });

  useEffect(() => { if (prop.data) { setF(fromApi(prop.data)); setDirty(false); } }, [prop.data]);
  useEffect(() => { if (isNew && user && !f.brokerId) setF((x) => ({ ...x, brokerId: user.id })); }, [isNew, user]); // eslint-disable-line

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const text = (k: keyof Form) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => set(k, e.target.value as never) });
  const fe = fieldErrors(err);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['properties'] }); qc.invalidateQueries({ queryKey: ['property', id] }); qc.invalidateQueries({ queryKey: ['property-history', id] }); };

  const save = useMutation({
    mutationFn: async (): Promise<any> => {
      const body = toApi(f, canEdit);
      return isNew ? api('/properties', { method: 'POST', body }) : api(`/properties/${id}`, { method: 'PATCH', body });
    },
    onSuccess: (p) => {
      refresh(); setDirty(false); setErr(null);
      if (isNew) nav(`/imoveis/${p.id}`, { replace: true }); else toast.show('Alterações salvas.');
    },
    onError: setErr,
  });

  const act = useMutation({
    mutationFn: async (kind: 'publish' | 'unpublish' | 'archive') => {
      if (dirty) await api(`/properties/${id}`, { method: 'PATCH', body: toApi(f, canEdit) });
      return api(`/properties/${id}/${kind}`, { method: 'POST' });
    },
    onSuccess: (_, kind) => { refresh(); setDirty(false); setErr(null); toast.show(kind === 'publish' ? 'Imóvel publicado.' : kind === 'unpublish' ? 'Imóvel despublicado.' : 'Imóvel arquivado.'); },
    onError: setErr,
  });
  const del = useMutation({
    mutationFn: () => api(`/properties/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); nav('/imoveis'); },
    onError: setErr,
  });

  // ViaCEP: preenche endereço a partir do CEP.
  async function lookupCep() {
    const cep = f.zipCode.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const r = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
      if (r.erro) return;
      setF((x) => ({ ...x, address: x.address || r.logradouro || '', neighborhood: x.neighborhood || r.bairro || '', city: x.city || r.localidade || '', state: x.state || r.uf || '' }));
      setDirty(true);
    } catch { /* o preenchimento manual continua disponível */ }
  }

  if (!isNew && prop.isLoading) return <div className="card"><SkeletonRows rows={10} /></div>;
  if (!isNew && prop.error) return <div className="alert">{errorMessage(prop.error)}</div>;

  const p = prop.data;
  const showSale = f.purpose !== 'RENT';
  const showRent = f.purpose !== 'SALE';
  const busy = save.isPending || act.isPending;
  const groups = new Map<string, typeof features.data>();
  for (const ft of features.data ?? []) if (ft.active || f.featureIds.includes(ft.id)) groups.set(ft.category ?? 'Outras', [...(groups.get(ft.category ?? 'Outras') ?? []), ft]);
  const incomplete = err instanceof ApiError && err.code === 'PROPERTY_INCOMPLETE' ? (err.details as { message: string }[]) : null;

  return (
    <>
      <Link to="/imoveis" className="backlink"><ArrowLeft /> Imóveis</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">{isNew ? 'Novo imóvel' : p.title}</h1>
          {!isNew && <p className="page-sub"><Badge plain>{p.code}</Badge> &nbsp;{[p.neighborhood, p.city].filter(Boolean).join(', ')}</p>}
        </div>
      </div>

      {err != null && !Object.keys(fe).length && !incomplete && <div className="alert" style={{ marginBottom: 16 }}>{errorMessage(err)}</div>}
      {incomplete && (
        <div className="alert" style={{ marginBottom: 16 }}>
          <strong style={{ fontWeight: 600 }}>Para publicar, complete:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{incomplete.map((d, i) => <li key={i}>{d.message}</li>)}</ul>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (!readOnly) { setErr(null); save.mutate(); } }}>
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-page">
            <div className="stack">
              <Section title="Dados principais">
                <div className="form-grid">
                  <Field label="Título do anúncio" className="span-2" error={fe.title}><Input required maxLength={160} {...text('title')} placeholder="Ex.: Apartamento com 3 suítes e vista para o parque" /></Field>
                  <Field label="Finalidade"><Select value={f.purpose} onChange={(e) => set('purpose', e.target.value as PropertyPurpose)}>{PROPERTY_PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_LABELS[x]}</option>)}</Select></Field>
                  <Field label="Tipo" error={fe.typeId}>
                    <Select required value={f.typeId} onChange={(e) => set('typeId', e.target.value)}>
                      <option value="">Selecione…</option>
                      {types.data?.filter((x) => x.active || x.id === f.typeId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Subtipo" className="span-2"><Input {...text('subtype')} placeholder="Ex.: Duplex, Studio, Térrea…" /></Field>
                  <Field label="Resumo" className="span-2" hint="Aparece nos cartões de listagem e no compartilhamento."><Input maxLength={300} {...text('shortDescription')} /></Field>
                  <Field label="Descrição completa" className="span-2"><textarea className="input textarea" rows={6} {...text('description')} /></Field>
                </div>
              </Section>

              {isNew ? (
                <Section title="Fotos e vídeos">
                  <div className="photos-soon"><Images /><strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Salve o rascunho para adicionar fotos</strong><span>Depois de salvar, você poderá enviar as fotos, escolher a capa e reordenar.</span></div>
                </Section>
              ) : can('media.view') && <Gallery propertyId={id!} />}

              <Section title="Ambientes e áreas">
                <div className="form-grid g4">
                  <Field label="Dormitórios"><Input type="number" min={0} {...text('bedrooms')} /></Field>
                  <Field label="Suítes"><Input type="number" min={0} {...text('suites')} /></Field>
                  <Field label="Banheiros"><Input type="number" min={0} {...text('bathrooms')} /></Field>
                  <Field label="Vagas"><Input type="number" min={0} {...text('parkingSpaces')} /></Field>
                  <Field label="Área total (m²)"><Input type="number" min={0} step="any" {...text('totalArea')} /></Field>
                  <Field label="Área útil (m²)"><Input type="number" min={0} step="any" {...text('usefulArea')} /></Field>
                  <Field label="Área construída (m²)"><Input type="number" min={0} step="any" {...text('builtArea')} /></Field>
                  <Field label="Área do terreno (m²)"><Input type="number" min={0} step="any" {...text('landArea')} /></Field>
                </div>
              </Section>

              <Section title="Valores">
                <div className="form-grid">
                  {showSale && <Field label="Valor de venda" error={fe.salePrice}><MoneyInput value={f.salePrice} onChange={(v) => set('salePrice', v)} /></Field>}
                  {showRent && <Field label="Valor do aluguel (mensal)" error={fe.rentPrice}><MoneyInput value={f.rentPrice} onChange={(v) => set('rentPrice', v)} /></Field>}
                  <Field label="Condomínio (mensal)"><MoneyInput value={f.condominiumFee} onChange={(v) => set('condominiumFee', v)} /></Field>
                  <Field label="IPTU (mensal)"><MoneyInput value={f.propertyTax} onChange={(v) => set('propertyTax', v)} /></Field>
                  {showSale && canEdit && (
                    <Field label="Valor mínimo de negociação" className="span-2" hint="Confidencial: visível somente para quem edita imóveis. Não vai para o site.">
                      <MoneyInput value={f.minimumNegotiationPrice} onChange={(v) => set('minimumNegotiationPrice', v)} />
                    </Field>
                  )}
                </div>
              </Section>

              <Section title="Endereço">
                <div className="form-grid g3">
                  <Field label="CEP"><Input value={f.zipCode} onChange={(e) => set('zipCode', e.target.value)} onBlur={lookupCep} placeholder="00000-000" /></Field>
                  <Field label="Endereço" className="span-2"><Input {...text('address')} /></Field>
                  <Field label="Número"><Input {...text('number')} /></Field>
                  <Field label="Complemento" className="span-2"><Input {...text('complement')} /></Field>
                  <Field label="Bairro"><Input {...text('neighborhood')} /></Field>
                  <Field label="Cidade"><Input {...text('city')} /></Field>
                  <Field label="UF" error={fe.state}><Input maxLength={2} {...text('state')} /></Field>
                  <div className="span-2" style={{ gridColumn: '1 / -1' }}>
                    <label className="check"><input type="checkbox" checked={f.showExactAddress} onChange={(e) => set('showExactAddress', e.target.checked)} />
                      <span>Mostrar endereço exato no site<small>Desmarcado, o site exibe apenas bairro e cidade.</small></span></label>
                  </div>
                </div>
              </Section>

              <Section title="Características" desc="Selecione tudo o que o imóvel oferece.">
                {features.isLoading ? <SkeletonRows rows={3} /> : [...groups].map(([cat, items]) => (
                  <div key={cat} className="chip-group">
                    <div className="chip-label">{cat}</div>
                    <div className="chips">
                      {items!.map((ft) => (
                        <button type="button" key={ft.id} className={`chip ${f.featureIds.includes(ft.id) ? 'on' : ''}`} aria-pressed={f.featureIds.includes(ft.id)}
                          onClick={() => set('featureIds', f.featureIds.includes(ft.id) ? f.featureIds.filter((x) => x !== ft.id) : [...f.featureIds, ft.id])}>{ft.name}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </Section>

              {!isNew && canEdit && (
                <Section title="Histórico">
                  {history.isLoading ? <SkeletonRows rows={3} /> : !history.data?.length ? <span className="card-sub">Nenhuma alteração registrada.</span> : (
                    <ul className="hist">
                      {history.data.map((h) => (
                        <li key={h.id}>
                          <div><b style={{ fontWeight: 500 }}>{ACTION_LABEL[h.action] ?? h.action}</b> <span className="card-sub">por {h.userName ?? 'Sistema'} · {dateTime(h.createdAt)}</span></div>
                          {h.action === 'UPDATE' && (
                            <div className="diff">
                              {Object.keys({ ...h.before, ...h.after }).map((k) => (
                                <div key={k}><b>{k}</b> {h.before && k in h.before && <span className="rm">− {typeof h.before[k] === 'object' ? JSON.stringify(h.before[k]) : String(h.before[k])}</span>} {h.after && k in h.after && <span className="add">+ {typeof h.after[k] === 'object' ? JSON.stringify(h.after[k]) : String(h.after[k])}</span>}</div>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}
            </div>

            <aside className="aside stack">
              <section className="card">
                <div className="card-head"><div className="section-title">Publicação</div>{!isNew && statusBadge(p)}</div>
                <div className="section-body kv">
                  <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value as PropertyStatus)} disabled={!isNew && p.status === 'ARCHIVED'}>
                    {PROPERTY_STATUSES.filter((x) => x !== 'ARCHIVED' && !(x === 'DRAFT' && p?.published)).map((x) => <option key={x} value={x}>{STATUS_LABELS[x]}</option>)}
                    {!isNew && p.status === 'ARCHIVED' && <option value="ARCHIVED">{STATUS_LABELS.ARCHIVED}</option>}
                  </Select></Field>
                  {!isNew && (
                    <div className="card-sub">{p.published ? `No site desde ${dateTime(p.publishedAt)}` : 'Não publicado no site.'}</div>
                  )}
                  <label className="check"><input type="checkbox" checked={f.featured} onChange={(e) => set('featured', e.target.checked)} /><span>Imóvel em destaque<small>Aparece com prioridade no site.</small></span></label>
                  {!isNew && p.published && can('marketing.manage') && (
                    <Button type="button" block onClick={() => nav(`/redes-sociais/nova?imovel=${p.id}`)}><Share2 /> Publicar nas redes</Button>
                  )}
                  {!isNew && can('property.publish') && (
                    p.published
                      ? <Button type="button" block disabled={busy} onClick={() => act.mutate('unpublish')}>Despublicar</Button>
                      : <Button type="button" variant="primary" block disabled={busy} onClick={() => act.mutate('publish')}>Publicar no site</Button>
                  )}
                </div>
              </section>

              <section className="card">
                <div className="card-head"><div className="section-title">Responsáveis</div></div>
                <div className="section-body kv">
                  <Field label="Corretor responsável">
                    <Select value={f.brokerId} onChange={(e) => set('brokerId', e.target.value)}>
                      <option value="">Sem corretor</option>{options.data?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Filial">
                    <Select value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>
                      <option value="">Sem filial</option>{branches.data?.filter((b) => b.active || b.id === f.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                </div>
              </section>

              {canEdit && (
                <section className="card">
                  <div className="card-head"><div className="section-title">Proprietário</div></div>
                  <div className="section-body kv">
                    <Select value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
                      <option value="">Sem proprietário</option>{owners.data?.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                    {can('property.create') && <Button type="button" variant="ghost" onClick={() => setOwnerModal(true)}>+ Cadastrar novo proprietário</Button>}
                  </div>
                </section>
              )}

              {!isNew && p.published && p.status === 'AVAILABLE' && can('lead.view') && <PropertyMatches propertyId={id!} />}

              {!isNew && (can('property.archive') || can('property.delete')) && (
                <section className="card">
                  <div className="section-body kv">
                    {can('property.archive') && p.status !== 'ARCHIVED' && <Button type="button" disabled={busy} onClick={() => confirm('Arquivar este imóvel? Ele sai do site.') && act.mutate('archive')}>Arquivar imóvel</Button>}
                    {can('property.delete') && p.status === 'DRAFT' && !p.publishedAt && <Button type="button" variant="danger" disabled={busy} onClick={() => confirm('Excluir este rascunho definitivamente?') && del.mutate()}>Excluir rascunho</Button>}
                  </div>
                </section>
              )}
            </aside>
          </div>
        </fieldset>

        {!readOnly && (
          <div className="savebar">
            <span className="card-sub">{dirty ? 'Há alterações não salvas.' : isNew ? 'Preencha os dados e salve o rascunho.' : 'Tudo salvo.'}</span>
            <div className="toolbar">
              <Button type="button" onClick={() => nav('/imoveis')}>Cancelar</Button>
              <Button variant="primary" disabled={busy || (!isNew && !dirty)}>{save.isPending ? 'Salvando…' : isNew ? 'Salvar rascunho' : 'Salvar alterações'}</Button>
            </div>
          </div>
        )}
      </form>

      {ownerModal && <OwnerModal owner={null} onClose={() => setOwnerModal(false)} onSaved={(o) => { setOwnerModal(false); qc.invalidateQueries({ queryKey: ['owners'] }); set('ownerId', o.id); toast.show('Proprietário criado e vinculado.'); }} />}
      {toast.node}
    </>
  );
}
