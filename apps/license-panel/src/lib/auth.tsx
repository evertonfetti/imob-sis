import type { StaffAuthResponse } from '@imob/types';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, publicApi, session } from './api';

interface Staff { id: string; name: string; email: string }
interface AuthState {
  staff: Staff | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(!!session.get());

  useEffect(() => {
    if (!session.get()) return;
    api<Staff>('/auth/me').then(setStaff).catch(() => session.set(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => session.subscribe((s) => { if (!s) { setStaff(null); qc.clear(); } }), [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await publicApi<StaffAuthResponse>('/auth/login', { email, password });
    session.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    setStaff(r.staff);
  }, []);

  const logout = useCallback(async () => {
    const s = session.get();
    session.set(null);
    if (s) await publicApi('/auth/logout', { refreshToken: s.refreshToken }).catch(() => undefined);
  }, []);

  const value = useMemo<AuthState>(() => ({ staff, loading, login, logout }), [staff, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
