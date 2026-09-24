import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Fragment } from 'react';
import { PageHeader, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';

interface RolesResponse {
  roles: { id: string; key: string; name: string; userCount: number; permissions: string[] }[];
  permissions: { key: string; description: string }[];
}

const GROUPS: Record<string, string> = {
  admin: 'Administração', property: 'Imóveis', media: 'Mídia', lead: 'Leads', crm: 'CRM',
  visit: 'Visitas', proposal: 'Propostas', marketing: 'Marketing',
};

export function Roles() {
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api<RolesResponse>('/roles') });
  const groups = q.data ? Object.entries(GROUPS).map(([prefix, label]) => ({ label, items: q.data!.permissions.filter((p) => p.key.startsWith(prefix + '.')) })) : [];

  return (
    <>
      <PageHeader title="Permissões" subtitle="O que cada papel pode fazer no sistema." />
      <div className="card">
        {q.isLoading ? <SkeletonRows rows={8} /> : (
          <div className="table-wrap">
            <table className="table matrix">
              <thead>
                <tr><th>Permissão</th>{q.data!.roles.map((r) => <th key={r.id}>{r.name}<div className="card-sub" style={{ fontWeight: 400 }}>{r.userCount} {r.userCount === 1 ? 'usuário' : 'usuários'}</div></th>)}</tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.label}>
                    <tr className="grp"><td colSpan={q.data!.roles.length + 1}>{g.label}</td></tr>
                    {g.items.map((p) => (
                      <tr key={p.key}>
                        <td>{p.description}<div className="card-sub">{p.key}</div></td>
                        {q.data!.roles.map((r) => (
                          <td key={r.id}>{r.permissions.includes(p.key) ? <span className="tick"><Check /></span> : <span className="dash">–</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
