import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Input, PageHeader, SkeletonRows, errorMessage, useToast } from '../components/ui';
import { api } from '../lib/api';

interface PType { id: string; name: string; active: boolean }
interface Feature { id: string; name: string; category: string | null; active: boolean }

export function Catalog() {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useQuery({ queryKey: ['types'], queryFn: () => api<PType[]>('/property-types') });
  const features = useQuery({ queryKey: ['features'], queryFn: () => api<Feature[]>('/features') });
  const [typeName, setTypeName] = useState('');
  const [feat, setFeat] = useState({ name: '', category: '' });

  const onError = (e: unknown) => toast.show(errorMessage(e));
  const refresh = (k: string) => () => qc.invalidateQueries({ queryKey: [k] });
  const addType = useMutation({ mutationFn: () => api('/property-types', { method: 'POST', body: { name: typeName } }), onSuccess: () => { setTypeName(''); refresh('types')(); }, onError });
  const toggleType = useMutation({ mutationFn: (t: PType) => api(`/property-types/${t.id}`, { method: 'PATCH', body: { active: !t.active } }), onSuccess: refresh('types'), onError });
  const addFeature = useMutation({ mutationFn: () => api('/features', { method: 'POST', body: { name: feat.name, category: feat.category || null } }), onSuccess: () => { setFeat({ name: '', category: '' }); refresh('features')(); }, onError });
  const toggleFeature = useMutation({ mutationFn: (f: Feature) => api(`/features/${f.id}`, { method: 'PATCH', body: { active: !f.active } }), onSuccess: refresh('features'), onError });

  const grouped = new Map<string, Feature[]>();
  for (const f of features.data ?? []) grouped.set(f.category ?? 'Outras', [...(grouped.get(f.category ?? 'Outras') ?? []), f]);

  return (
    <>
      <PageHeader title="Catálogo" subtitle="Tipos de imóvel e características usados nos cadastros. Itens desativados deixam de aparecer, sem afetar imóveis já cadastrados." />
      <div className="two-col" style={{ alignItems: 'start' }}>
        <section className="card">
          <div className="card-head"><div className="card-title">Tipos de imóvel</div></div>
          <div className="section-body">
            <form className="inline-add" onSubmit={(e) => { e.preventDefault(); if (typeName.trim()) addType.mutate(); }}>
              <Input placeholder="Novo tipo (ex.: Loft)" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
              <Button variant="primary" disabled={!typeName.trim()}>Adicionar</Button>
            </form>
            {types.isLoading ? <SkeletonRows rows={4} /> : types.data?.map((t) => (
              <div key={t.id} className={`catalog-row ${t.active ? '' : 'off'}`}>
                <span>{t.name}</span>
                <span className="toolbar">{!t.active && <Badge plain>Inativo</Badge>}<Button variant="ghost" onClick={() => toggleType.mutate(t)}>{t.active ? 'Desativar' : 'Ativar'}</Button></span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div className="card-title">Características</div></div>
          <div className="section-body">
            <form className="inline-add" onSubmit={(e) => { e.preventDefault(); if (feat.name.trim()) addFeature.mutate(); }}>
              <Input placeholder="Nova característica" value={feat.name} onChange={(e) => setFeat({ ...feat, name: e.target.value })} />
              <Input placeholder="Categoria" style={{ flexBasis: 120 }} value={feat.category} onChange={(e) => setFeat({ ...feat, category: e.target.value })} />
              <Button variant="primary" disabled={!feat.name.trim()}>Adicionar</Button>
            </form>
            {features.isLoading ? <SkeletonRows rows={5} /> : [...grouped].map(([cat, items]) => (
              <div key={cat}>
                <div className="grp-title">{cat}</div>
                {items.map((f) => (
                  <div key={f.id} className={`catalog-row ${f.active ? '' : 'off'}`}>
                    <span>{f.name}</span>
                    <Button variant="ghost" onClick={() => toggleFeature.mutate(f)}>{f.active ? 'Desativar' : 'Ativar'}</Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
      {toast.node}
    </>
  );
}
