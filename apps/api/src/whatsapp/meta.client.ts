export class MetaApiError extends Error {
  constructor(message: string, public readonly code?: number, public readonly status?: number) {
    super(message);
  }
}

export interface MetaConfig { graphUrl: string; version: string; phoneNumberId: string; accessToken: string }

/** Cliente mínimo da WhatsApp Business Cloud API (Meta). Todas as chamadas à Meta passam por aqui. */
export class MetaClient {
  constructor(private readonly cfg: MetaConfig) {}

  private async request<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${this.cfg.graphUrl}/${this.cfg.version}/${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new MetaApiError(data?.error?.error_data?.details ?? data?.error?.message ?? `Erro ${res.status} da Meta`, data?.error?.code, res.status);
    return data as T;
  }

  async sendText(to: string, body: string): Promise<string> {
    const r = await this.request<{ messages: { id: string }[] }>(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: true } },
    });
    return r.messages[0]!.id;
  }

  async sendTemplate(to: string, name: string, language: string, params: string[] = []): Promise<string> {
    const r = await this.request<{ messages: { id: string }[] }>(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name, language: { code: language }, ...(params.length && { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] }) },
      },
    });
    return r.messages[0]!.id;
  }

  /** Marca como lida (os dois "vistos" azuis do lado do cliente). */
  async markRead(wamid: string) {
    await this.request(`${this.cfg.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', status: 'read', message_id: wamid } });
  }

  getPhone() {
    return this.request<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
      `${this.cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    );
  }

  /** Baixa uma mídia recebida: primeiro resolve a URL temporária pelo ID, depois baixa o arquivo. */
  async downloadMedia(mediaId: string, maxBytes = 25 * 1024 * 1024): Promise<{ buffer: Buffer; mime: string }> {
    const meta = await this.request<{ url: string; mime_type: string; file_size?: number }>(mediaId);
    if (meta.file_size && meta.file_size > maxBytes) throw new MetaApiError('Arquivo grande demais para baixar');
    const res = await fetch(meta.url, { headers: { authorization: `Bearer ${this.cfg.accessToken}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new MetaApiError(`Falha ao baixar o arquivo (${res.status})`, undefined, res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new MetaApiError('Arquivo grande demais para baixar');
    return { buffer, mime: meta.mime_type };
  }
}
