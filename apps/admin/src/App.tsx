import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { Audit } from './pages/Audit';
import { CompanyPage } from './pages/Company';
import { Dashboard } from './pages/Dashboard';
import { ForgotPassword, Login, ResetPassword } from './pages/Login';
import { Roles } from './pages/Roles';
import { Users } from './pages/Users';

function Protected() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  return user ? <Outlet /> : <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
}

function Guard({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Login />} />
      <Route path="/esqueci-senha" element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route element={<Protected />}>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="usuarios" element={<Guard perm="admin.users"><Users /></Guard>} />
          <Route path="permissoes" element={<Guard perm="admin.users"><Roles /></Guard>} />
          <Route path="empresa" element={<Guard perm="admin.company"><CompanyPage /></Guard>} />
          <Route path="auditoria" element={<Guard perm="admin.audit"><Audit /></Guard>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
