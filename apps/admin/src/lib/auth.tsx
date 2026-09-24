import type { AuthResponse, AuthUser } from '@imob/types';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, publicApi, session } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  can: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(!!session.get());

  useEffect(() => {
    if (!session.get()) return;
    api<AuthUser>('/auth/me').then(setUser).catch(() => session.set(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => session.subscribe((s) => { if (!s) { setUser(null); qc.clear(); } }), [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await publicApi<AuthResponse>('/auth/login', { email, password });
    session.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    const s = session.get();
    session.set(null);
    if (s) await publicApi('/auth/logout', { refreshToken: s.refreshToken }).catch(() => undefined);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, can: (p) => !!user?.permissions.includes(p) }),
    [user, loading, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
