import type { Paginated } from '@imob/types';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge, Button, Empty, PageHeader, Select, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';

interface Log {
  id: string; entity: string; entityId: string | null; action: string; userName: string | null; ipAddress: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string;
}

const ENTITIES = { AUTH: 'Acesso', USER: 'Usuário', COMPANY: 'Empresa', BRANCH: 'Filial', PROPERTY: 'Imóvel', LEAD: 'Lead', CUSTOMER: 'Cliente', INTEGRATION: 'Integração',  PIPELINE_STAGE: 'Etapa do funil', OWNER: 'Proprietário', PROPERTY_TYPE: 'Tipo de imóvel', FEATURE: 'Característica' } as const;
const ACTIONS: Record<string, [string, 'ok' | 'warn' | 'danger' | 'accent' | undefined]> = {
  LOGIN: ['Login', 'ok'], LOGOUT: ['Logout', undefined], LOGIN_FAILED: ['Login falhou', 'danger'], CREATE: ['Criação', 'accent'],
  UPDATE: ['Alteração', 'warn'], DEACTIVATE: ['Desativação', 'danger'], ROLE_CHANGE: ['Mudança de papel', 'warn'],
  PASSWORD_RESET: ['Senha redefinida', 'warn'], PUBLISH: ['Publicação', 'ok'], UNPUBLISH: ['Despublicação', 'warn'], ARCHIVE: ['Arquivamento', 'warn'], DELETE: ['Exclusão', 'danger'], STAGE_CHANGE: ['Mudança de etapa', 'accent'], ASSIGN: ['Atribuição', 'accent'], MEDIA_ADDED: ['Arquivo adicionado', 'accent'], MEDIA_REMOVED: ['Arquivo removido', 'warn'], COVER_CHANGED: ['Capa alterada', undefined], PASSWORD_RESET_REQUESTED: ['Redefinição solicitada', undefined],
};
const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

export function Audit() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['audit', page, entity],
    queryFn: () => api<Paginated<Log>>(`/audit-logs?page=${page}&pageSize=20${entity ? `&entity=${entity}` : ''}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Registro de quem fez o quê, e quando."
        actions={<Select style={{ width: 180 }} value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
          <option value="">Todos os registros</option>{Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>} />
      <div className="card">
        {q.isLoading ? <SkeletonRows rows={8} /> : !d?.items.length ? <Empty icon={<ScrollText />} title="Nada registrado ainda" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th /><th>Quando</th><th>Quem</th><th>Ação</th><th>Registro</th><th>IP</th></tr></thead>
              <tbody>
                {d.items.map((l) => {
                  const hasDiff = !!(l.before || l.after);
                  const [label, tone] = ACTIONS[l.action] ?? [l.action, undefined];
                  return (
                    <Fragment key={l.id}>
                      <tr>
                        <td style={{ width: 36, paddingRight: 0 }}>{hasDiff && <Button variant="ghost" size="icon" aria-label="Ver detalhes" onClick={() => setOpen(open === l.id ? null : l.id)}><ChevronRight size={16} style={{ rotate: open === l.id ? '90deg' : '0deg', transition: 'rotate .15s' }} /></Button>}</td>
                        <td className="card-sub" style={{ whiteSpace: 'nowrap' }}>{dateTime(l.createdAt)}</td>
                        <td>{l.userName ?? <span className="card-sub">Sistema</span>}</td>
                        <td><Badge tone={tone}>{label}</Badge></td>
                        <td>{ENTITIES[l.entity as keyof typeof ENTITIES] ?? l.entity}</td>
                        <td className="card-sub">{l.ipAddress ?? '—'}</td>
                      </tr>
                      {open === l.id && (
                        <tr className="diff-row"><td colSpan={6}>
                          <div className="diff">
                            {Object.keys({ ...l.before, ...l.after }).map((k) => (
                              <div key={k}>
                                <b>{k}</b>{' '}
                                {l.before && k in l.before && <span className="rm">− {fmt(l.before[k])}</span>}{' '}
                                {l.after && k in l.after && <span className="add">+ {fmt(l.after[k])}</span>}
                              </div>
                            ))}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && (
          <div className="pager"><span>Página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
    </>
  );
}
