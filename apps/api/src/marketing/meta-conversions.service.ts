import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ENV, Env } from '../config/env';
import { MetaApiError } from '../whatsapp/meta.client';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const norm = (v: string) => v.trim().toLowerCase();

export interface UserInput {
  email?: string | null;
  phone?: string | null; // só dígitos, sem DDI
  name?: string | null;
  leadId?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
}

export interface CapiEvent {
  eventName: string;
  eventId: string;
  eventTime: Date;
  actionSource: 'website' | 'system_generated' | 'chat';
  eventSourceUrl?: string | null;
  user: UserInput;
  customData?: Record<string, unknown>;
}

/** Monta o `user_data` da Meta: dados pessoais sempre com hash SHA-256, normalizados como a Meta exige. */
export function buildUserData(u: UserInput) {
  const parts = (u.name ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const digits = (u.phone ?? '').replace(/\D/g, '');
  const data: Record<string, unknown> = {
    ...(u.email && { em: [sha(norm(u.email))] }),
    ...(digits && { ph: [sha(digits.startsWith('55') && digits.length > 11 ? digits : `55${digits}`)] }),
    ...(parts[0] && { fn: [sha(parts[0])] }),
    ...(parts.length > 1 && { ln: [sha(parts[parts.length - 1]!)] }),
    ...(u.leadId && { external_id: [sha(u.leadId)] }),
    ...(u.fbc && { fbc: u.fbc }),
    ...(u.fbp && { fbp: u.fbp }),
    ...(u.clientIp && { client_ip_address: u.clientIp }),
    ...(u.clientUserAgent && { client_user_agent: u.clientUserAgent }),
  };
  return data;
}

export const hasIdentifiers = (u: UserInput) => !!(u.email || u.phone || u.fbc || u.fbp || u.clientIp);

export function buildEvent(e: CapiEvent) {
  return {
    event_name: e.eventName,
    event_time: Math.floor(e.eventTime.getTime() / 1000),
    event_id: e.eventId,
    action_source: e.actionSource,
    ...(e.eventSourceUrl && { event_source_url: e.eventSourceUrl }),
    user_data: buildUserData(e.user),
    ...(e.customData && Object.keys(e.customData).length && { custom_data: e.customData }),
  };
}

/**
 * Único ponto do sistema que fala com a Conversions API da Meta.
 * Nunca espalhe chamadas à Meta por outros serviços: use MarketingService.track().
 */
@Injectable()
export class MetaConversionsService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async request(pixelId: string, accessToken: string, path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await fetch(`${this.env.WHATSAPP_GRAPH_URL}/${this.env.WHATSAPP_API_VERSION}/${pixelId}${path}`, {
      method: init.method ?? 'GET',
      // O token vai no cabeçalho (não na URL), para não aparecer em logs de acesso.
      headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new MetaApiError(data?.error?.error_user_msg ?? data?.error?.message ?? `Erro ${res.status} da Meta`, data?.error?.code, res.status);
    return data;
  }

  /** Envia um evento. Retorna a resposta da Meta (events_received, fbtrace_id). */
  sendEvent(cfg: { pixelId: string; accessToken: string; testEventCode?: string | null }, event: ReturnType<typeof buildEvent>) {
    return this.request(cfg.pixelId, cfg.accessToken, '/events', {
      method: 'POST',
      body: { data: [event], ...(cfg.testEventCode && { test_event_code: cfg.testEventCode }) },
    }) as Promise<{ events_received?: number; fbtrace_id?: string }>;
  }

  /** Valida o token consultando o Pixel (não envia evento nenhum). */
  getPixel(cfg: { pixelId: string; accessToken: string }) {
    return this.request(cfg.pixelId, cfg.accessToken, '?fields=name,id') as Promise<{ id: string; name?: string }>;
  }
}
