import { ROLE_KEYS, ROLE_LABELS, type Paginated } from '@imob/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users as UsersIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, SkeletonRows, errorMessage, fieldErrors, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, initials } from '../lib/format';

interface UserRow {
  id: string; name: string; email: string; phone: string | null; creci: string | null; status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  branchId: string | null; lastLoginAt: string | null; role: { key: string; name: string }; branch: { id: string; name: string } | null;
}
interface Branch { id: string; name: string; active: boolean }

const STATUS = { ACTIVE: ['Ativo', 'ok'], INACTIVE: ['Inativo', undefined], BLOCKED: ['Bloqueado', 'danger'] } as const;

export function Users() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const toast = useToast();

  const list = useQuery({
    queryKey: ['users', search, page],
    queryFn: () => api<Paginated<UserRow>>(`/users?page=${page}&pageSize=15${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.show('Usuário desativado.'); },
    onError: (e) => toast.show(errorMessage(e)),
  });

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Usuários" subtitle="Quem tem acesso ao painel e com qual papel."
        actions={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> Novo usuário</Button>} />
      <div className="card">
        <div className="card-head">
          <div className="input-icon" style={{ width: 320, maxWidth: '100%' }}>
            <Search />
            <Input placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <span className="card-sub">{data ? `${data.total} ${data.total === 1 ? 'usuário' : 'usuários'}` : ''}</span>
        </div>
        {list.isLoading ? <SkeletonRows /> : !data?.items.length ? (
          <Empty icon={<UsersIcon />} title="Nenhum usuário encontrado" hint="Ajuste a busca ou cadastre um novo usuário." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Usuário</th><th>Papel</th><th>Filial</th><th>Status</th><th>Último acesso</th><th /></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td><div className="cell-user"><div className="avatar">{initials(u.name)}</div><div><strong>{u.name}</strong><span>{u.email}</span></div></div></td>
                    <td><Badge plain tone="accent">{u.role.name}</Badge></td>
                    <td>{u.branch?.name ?? <span className="card-sub">—</span>}</td>
                    <td><Badge tone={STATUS[u.status][1]}>{STATUS[u.status][0]}</Badge></td>
                    <td className="card-sub">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Nunca acessou'}</td>
                    <td className="actions">
                      <Button variant="ghost" onClick={() => setEditing(u)}>Editar</Button>
                      {u.status === 'ACTIVE' && u.id !== me!.id && (
                        <Button variant="ghost" className="btn-danger" onClick={() => confirm(`Desativar ${u.name}? A pessoa perderá o acesso imediatamente.`) && deactivate.mutate(u.id)}>Desativar</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="pager">
            <span>Página {page} de {pages}</span>
            <div className="toolbar"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>
          </div>
        )}
      </div>
      {editing && <UserModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast.show(m); }} />}
      {toast.node}
    </>
  );
}

function UserModal({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const [f, setF] = useState({
    name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', creci: user?.creci ?? '',
    branchId: user?.branchId ?? '', roleKey: user?.role.key ?? 'BROKER', status: user?.status ?? 'ACTIVE', password: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [err, setErr] = useState<unknown>(null);
  const fe = fieldErrors(err);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, email: f.email, phone: f.phone || null, creci: f.creci || null, branchId: f.branchId || null,
        roleKey: f.roleKey, ...(user ? { status: f.status } : {}), ...(f.password ? { password: f.password } : {}),
      };
      return user ? api(`/users/${user.id}`, { method: 'PATCH', body }) : api('/users', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onSaved(user ? 'Usuário atualizado.' : 'Usuário criado.'); },
    onError: setErr,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); };
  const roles = ROLE_KEYS.filter((k) => k !== 'ADMIN' || me!.role.key === 'ADMIN');

  return (
    <Modal title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}
      footer={<><Button onClick={onClose} type="button">Cancelar</Button><Button variant="primary" form="user-form" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button></>}>
      <form id="user-form" onSubmit={submit} className="form-grid">
        {err != null && !Object.keys(fe).length && <div className="alert span-2">{errorMessage(err)}</div>}
        <Field label="Nome" className="span-2" error={fe.name}><Input required value={f.name} onChange={set('name')} /></Field>
        <Field label="E-mail" error={fe.email}><Input type="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label="Telefone" error={fe.phone}><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Papel" error={fe.roleKey}><Select value={f.roleKey} onChange={set('roleKey')}>{roles.map((k) => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}</Select></Field>
        <Field label="Filial"><Select value={f.branchId} onChange={set('branchId')}><option value="">Sem filial</option>{branches.data?.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="CRECI" error={fe.creci}><Input value={f.creci} onChange={set('creci')} /></Field>
        {user && <Field label="Status"><Select value={f.status} onChange={set('status')}><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option><option value="BLOCKED">Bloqueado</option></Select></Field>}
        <Field label={user ? 'Nova senha' : 'Senha'} className="span-2" error={fe.password} hint={user ? 'Deixe em branco para manter a atual.' : 'Mínimo de 10 caracteres, com letras e números.'}>
          <Input type="password" autoComplete="new-password" required={!user} value={f.password} onChange={set('password')} />
        </Field>
      </form>
    </Modal>
  );
}
