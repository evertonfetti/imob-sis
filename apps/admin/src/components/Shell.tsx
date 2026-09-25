import {
  Building2, CalendarDays, Contact, Kanban, ListChecks, FileSignature, Gauge, Handshake, Home, Images, KeyRound, LogOut,
  Megaphone, Menu, MessageCircle, Plug, ScrollText, Store, Tags, UserRound, Users, BarChart3, type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';

interface Item { label: string; icon: LucideIcon; to?: string; perm?: string; badge?: 'unread' }
interface Group { label?: string; items: Item[] }

// Itens sem `to` pertencem a blocos futuros e aparecem desabilitados.
const NAV: Group[] = [
  { items: [{ label: 'Dashboard', icon: Gauge, to: '/' }] },
  { label: 'Imóveis', items: [
    { label: 'Imóveis', icon: Home, to: '/imoveis', perm: 'property.view' },
    { label: 'Proprietários', icon: UserRound, to: '/proprietarios', perm: 'property.edit' },
    { label: 'Catálogo', icon: Tags, to: '/catalogo', perm: 'property.edit' },
  ] },
  { label: 'Relacionamento', items: [
    { label: 'Pipeline', icon: Kanban, to: '/pipeline', perm: 'lead.view' },
    { label: 'Leads', icon: Handshake, to: '/leads', perm: 'lead.view' },
    { label: 'Conversas', icon: MessageCircle, to: '/conversas', perm: 'lead.view', badge: 'unread' },
    { label: 'Clientes', icon: Contact, to: '/clientes', perm: 'lead.view' },
    { label: 'Tarefas', icon: ListChecks, to: '/tarefas', perm: 'lead.view' },
    { label: 'Agenda', icon: CalendarDays, perm: 'visit.view' },
    { label: 'Propostas', icon: FileSignature, perm: 'proposal.view' },
  ] },
  { label: 'Marketing', items: [
    { label: 'Marketing', icon: Megaphone, to: '/marketing', perm: 'marketing.view' },
    { label: 'Mídia / IA', icon: Images, perm: 'media.view' },
    { label: 'Relatórios', icon: BarChart3 },
  ] },
  { label: 'Administração', items: [
    { label: 'Usuários', icon: Users, to: '/usuarios', perm: 'admin.users' },
    { label: 'Permissões', icon: KeyRound, to: '/permissoes', perm: 'admin.users' },
    { label: 'Empresa e filiais', icon: Building2, to: '/empresa', perm: 'admin.company' },
    { label: 'Integrações', icon: Plug, to: '/integracoes', perm: 'admin.company' },
    { label: 'Auditoria', icon: ScrollText, to: '/auditoria', perm: 'admin.audit' },
  ] },
];

export function Shell() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const unread = useQuery({ queryKey: ['conv-unread'], queryFn: () => api<{ unread: number }>('/conversations/unread'), enabled: can('lead.view'), refetchInterval: 20_000 });
  const close = () => setOpen(false);
  if (!user) return null;

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.items.length);

  return (
    <div className="app">
      <div className={`scrim ${open ? 'open' : ''}`} onClick={close} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Store /></div>
          <div>
            <div className="brand-name">Imobiliária</div>
            <div className="brand-sub">Painel de gestão</div>
          </div>
        </div>
        <nav className="nav" aria-label="Principal">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <div className="nav-label">{g.label}</div>}
              {g.items.map((i) =>
                i.to ? (
                  <NavLink key={i.label} to={i.to} end={i.to === '/'} onClick={close} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <i.icon /> {i.label}{i.badge === 'unread' && !!unread.data?.unread && <span className="nav-badge">{unread.data.unread > 99 ? '99+' : unread.data.unread}</span>}
                  </NavLink>
                ) : (
                  <div key={i.label} className="nav-item disabled" title="Disponível em breve" aria-disabled="true">
                    <i.icon /> {i.label}<span className="nav-soon">EM BREVE</span>
                  </div>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me">
            <div className="avatar">{initials(user.name)}</div>
            <div className="me-info"><strong>{user.name}</strong><span>{user.role.name}</span></div>
            <button className="btn btn-ghost btn-icon" title="Sair" aria-label="Sair" onClick={async () => { await logout(); nav('/entrar'); }}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={18} /></button>
          <strong style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500 }}>Imobiliária</strong>
        </header>
        <main className="content" key={loc.pathname}><Outlet /></main>
      </div>
    </div>
  );
}

