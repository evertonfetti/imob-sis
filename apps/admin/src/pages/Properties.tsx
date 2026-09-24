import { PROPERTY_PURPOSES, PURPOSE_LABELS, STATUS_LABELS, type Paginated, type PropertyStatus } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { Home, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Empty, Input, PageHeader, Select, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { brl } from '../lib/money';

export interface PropertyRow {
  id: string; code: string; slug: string; title: string; purpose: keyof typeof PURPOSE_LABELS; status: PropertyStatus; published: boolean;
  salePrice: number | null; rentPrice: number | null; neighborhood: string | null; city: string | null; state: string | null;
  bedrooms: number | null; parkingSpaces: number | null; totalArea: number | null;
  coverUrl: string | null; mediaCount: number;
  type: { id: string; name: string }; broker: { id: string; name: string } | null;
}

const TABS: { key: string; label: string; params: string; count: (s: Record<string, number>) => number }[] = [
  { key: 'all', label: 'Todos', params: '', count: (s) => Object.entries(s).filter(([k]) => k !== 'published').reduce((a, [, v]) => a + v, 0) },
  { key: 'draft', label: 'Rascunhos', params: '&status=DRAFT', count: (s) => s.DRAFT ?? 0 },
  { key: 'published', label: 'Publicados', params: '&published=true', count: (s) => s.published ?? 0 },
  { key: 'archived', label: 'Arquivados', params: '&status=ARCHIVED', count: (s) => s.ARCHIVED ?? 0 },
];

const STATUS_TONE: Partial<Record<PropertyStatus, 'ok' | 'warn' | 'danger' | 'accent'>> = {
  AVAILABLE: 'ok', RESERVED: 'warn', SOLD: 'accent', RENTED: 'accent',
};

export function statusBadge(p: { status: PropertyStatus }) {
  return <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status]}</Badge>;
}

export function Properties() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [purpose, setPurpose] = useState('');
  const [typeId, setTypeId] = useState('');
  const [page, setPage] = useState(1);

  const summary = useQuery({ queryKey: ['properties', 'summary'], queryFn: () => api<Record<string, number>>('/properties/summary') });
  const types = useQuery({ queryKey: ['types'], queryFn: () => api<{ id: string; name: string; active: boolean }[]>('/property-types') });
  const params = `page=${page}&pageSize=15${TABS.find((t) => t.key === tab)!.params}${search ? `&search=${encodeURIComponent(search)}` : ''}${purpose ? `&purpose=${purpose}` : ''}${typeId ? `&typeId=${typeId}` : ''}`;
  const list = useQuery({ queryKey: ['properties', params], queryFn: () => api<Paginated<PropertyRow>>(`/properties?${params}`), placeholderData: (p) => p });
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Imóveis" subtitle="Todo o portfólio em um só lugar."
        actions={can('property.create') && <Button variant="primary" onClick={() => nav('/imoveis/novo')}><Plus /> Novo imóvel</Button>} />
      <div className="seg" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" className={tab === t.key ? 'active' : ''} onClick={() => { setTab(t.key); reset(); }}>
            {t.label}{summary.data && <span className="count">{t.count(summary.data)}</span>}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="filters">
          <div className="input-icon"><Search /><Input placeholder="Buscar por título, código, bairro ou cidade" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} /></div>
          <Select value={purpose} onChange={(e) => { setPurpose(e.target.value); reset(); }}>
            <option value="">Finalidade</option>{PROPERTY_PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>)}
          </Select>
          <Select value={typeId} onChange={(e) => { setTypeId(e.target.value); reset(); }}>
            <option value="">Tipo</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
        {list.isLoading ? <SkeletonRows rows={6} /> : !d?.items.length ? (
          <Empty icon={<Home />} title="Nenhum imóvel encontrado" hint={summary.data && !TABS[0]!.count(summary.data) ? 'Cadastre o primeiro imóvel para começar.' : 'Ajuste os filtros para ver outros resultados.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Imóvel</th><th>Tipo</th><th>Valor</th><th>Status</th><th>Corretor</th></tr></thead>
              <tbody>
                {d.items.map((p) => (
                  <tr key={p.id} className="row-link" onClick={() => nav(`/imoveis/${p.id}`)}>
                    <td>
                      <div className="cell-user">
                        <div className="thumb">{p.coverUrl ? <img src={p.coverUrl} alt="" loading="lazy" /> : <Home />}</div>
                        <div style={{ minWidth: 0 }}>
                          <strong>{p.title}</strong>
                          <span>{p.code} · {[p.neighborhood, p.city].filter(Boolean).join(', ') || 'Sem endereço'}</span>
                        </div>
                      </div>
                    </td>
                    <td>{p.type.name}<div className="card-sub">{[p.bedrooms != null && `${p.bedrooms} dorm.`, p.totalArea != null && `${p.totalArea} m²`].filter(Boolean).join(' · ')}</div></td>
                    <td className="price">
                      {p.purpose !== 'RENT' && brl(p.salePrice)}
                      {p.purpose === 'RENT' ? brl(p.rentPrice) : p.purpose === 'SALE_AND_RENT' && <small>Aluguel {brl(p.rentPrice)}</small>}
                      {p.purpose === 'RENT' && <small>por mês</small>}
                    </td>
                    <td>{statusBadge(p)}{p.published && <div className="card-sub" style={{ marginTop: 4 }}>No site</div>}</td>
                    <td className="card-sub">{p.broker?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>{d.total} imóveis · página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
    </>
  );
}
