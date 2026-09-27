import { KeyRound, LogOut, ScrollText, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { label: 'Clientes', icon: Users, to: '/' },
  { label: 'Planos', icon: ScrollText, to: '/planos' },
];

export function Shell() {
  const { staff, logout } = useAuth();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><KeyRound /></div>
          <div>
            <div className="brand-name">Licenças</div>
            <div className="brand-sub">Painel master</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <n.icon />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me">
            <div className="me-info"><strong>{staff?.name}</strong><span>{staff?.email}</span></div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => void logout()} aria-label="Sair"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
