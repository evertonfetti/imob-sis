import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { ClientDetail } from './pages/ClientDetail';
import { Clients } from './pages/Clients';
import { LicenseDetail } from './pages/LicenseDetail';
import { Login } from './pages/Login';
import { Plans } from './pages/Plans';

function Protected() {
  const { staff, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  return staff ? <Outlet /> : <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Login />} />
      <Route element={<Protected />}>
        <Route element={<Shell />}>
          <Route index element={<Clients />} />
          <Route path="clientes/:id" element={<ClientDetail />} />
          <Route path="licencas/:id" element={<LicenseDetail />} />
          <Route path="planos" element={<Plans />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
