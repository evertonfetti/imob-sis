import type { ApiErrorBody, AuthResponse } from '@imob/types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api/v1';
const KEY = 'imob.session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public details?: unknown) {
    super(message);
  }
}

export interface Session { accessToken: string; refreshToken: string }
let listeners: Array<(s: Session | null) => void> = [];

export const session = {
  get(): Session | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  },
  set(s: Session | null) {
    if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
    listeners.forEach((l) => l(s));
  },
  subscribe(fn: (s: Session | null) => void) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  },
};

// Bloco 11 (SaaS): a API bloqueia TODA requisição (login incluído) quando a licença está suspensa.
// Isto é global e independe de sessão: mesmo a tela de login precisa saber para mostrar o aviso certo.
let licenseBlockMessage: string | null = null;
let licenseListeners: Array<(msg: string | null) => void> = [];
export const licenseBlock = {
  get: () => licenseBlockMessage,
  subscribe(fn: (msg: string | null) => void) {
    licenseListeners.push(fn);
    return () => { licenseListeners = licenseListeners.filter((l) => l !== fn); };
  },
};
function setLicenseBlock(msg: string | null) {
  if (msg === licenseBlockMessage) return;
  licenseBlockMessage = msg;
  licenseListeners.forEach((l) => l(msg));
}

async function raw(path: string, init: RequestInit & { token?: string | null } = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 204) { setLicenseBlock(null); return undefined; }
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const e = (data ?? {}) as Partial<ApiErrorBody>;
    if (e.code === 'LICENSE_SUSPENDED') setLicenseBlock(e.message ?? 'A licença deste sistema está suspensa.');
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? 'Não foi possível concluir a operação.', e.requestId, e.details);
  }
  setLicenseBlock(null);
  return data;
}

// Uma única renovação por vez, mesmo com várias requisições simultâneas expiradas.
let refreshing: Promise<Session> | null = null;
function refresh(): Promise<Session> {
  refreshing ??= (async () => {
    const current = session.get();
    if (!current) throw new ApiError(401, 'AUTH_REFRESH_INVALID', 'Sessão expirada.');
    try {
      const r = (await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: current.refreshToken }) })) as AuthResponse;
      const next = { accessToken: r.accessToken, refreshToken: r.refreshToken };
      session.set(next);
      return next;
    } catch (e) {
      session.set(null);
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const call = (token: string | null) => raw(path, { method: init.method, body, token });
  const s = session.get();
  try {
    return (await call(s?.accessToken ?? null)) as T;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && s) {
      const next = await refresh();
      return (await call(next.accessToken)) as T;
    }
    throw e;
  }
}

export const publicApi = <T = unknown>(path: string, body?: unknown, method = 'POST') =>
  raw(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }) as Promise<T>;
