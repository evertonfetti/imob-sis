import type { AuthResponse, AuthUser } from '@imob/types';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, publicApi, session } from './api';

/**
 * Marca este navegador como "equipe" no domínio principal (ex.: .seudominio.com.br), que o painel
 * compartilha com o site público. O site lê esse cookie e não envia essas visitas ao Pixel da Meta.
 * Tenta do domínio mais amplo para o mais específico: o navegador recusa sufixos públicos (.com.br).
 */
function markStaffBrowser() {
  try {
    const host = location.hostname;
    if (/^[\d.]+$/.test(host) || !host.includes('.')) { document.cookie = 'imob_staff=1; max-age=31536000; path=/; SameSite=Lax'; return; }
    const labels = host.split('.');
    for (let i = labels.length - 2; i >= 0; i--) {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `imob_staff=1; domain=.${labels.slice(i).join('.')}; max-age=31536000; path=/; SameSite=Lax${secure}`;
      if (/(?:^|; )imob_staff=1/.test(document.cookie)) return;
    }
  } catch { /* sem cookies: o site ainda filtra pelo endereço */ }
}

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
    api<AuthUser>('/auth/me').then((u) => { markStaffBrowser(); setUser(u); }).catch(() => session.set(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => session.subscribe((s) => { if (!s) { setUser(null); qc.clear(); } }), [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await publicApi<AuthResponse>('/auth/login', { email, password });
    session.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    markStaffBrowser();
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
