export class SocialApiError extends Error {
  constructor(message: string, public readonly code?: number, public readonly status?: number) {
    super(message);
  }
  /** Token inválido/expirado ou permissão revogada: a conta precisa ser reconectada. */
  get auth() { return this.code === 190 || this.code === 102 || (this.status === 401); }
  /** Falhas temporárias (limite de chamadas, erro interno da Meta, rede): vale tentar de novo. */
  get retryable() { return !this.auth && (this.status === undefined || this.status >= 500 || [1, 2, 4, 17, 32, 341, 613].includes(this.code ?? -1)); }
}

export interface GraphConfig { graphUrl: string; oauthUrl: string; version: string; appId: string; appSecret: string; pollMs: number }
export interface PageInfo { id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cliente da Graph API para login com o Facebook e publicação (Facebook Pages + Instagram). */
export class SocialGraph {
  constructor(private readonly c: GraphConfig) {}

  private async call<T = any>(path: string, o: { method?: string; token?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const qs = o.query ? `?${new URLSearchParams(o.query)}` : '';
    const res = await fetch(`${this.c.graphUrl}/${this.c.version}/${path}${qs}`, {
      method: o.method ?? 'GET',
      headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.body ? { 'content-type': 'application/json' } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => { throw new SocialApiError(`Sem conexão com a Meta (${(e as Error).message})`); });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new SocialApiError(data?.error?.error_user_msg ?? data?.error?.message ?? `Erro ${res.status} da Meta`, data?.error?.code, res.status);
    return data as T;
  }

  // ---------- Login ----------
  oauthDialogUrl(p: { redirectUri: string; state: string; scopes: string[] }) {
    const q = new URLSearchParams({ client_id: this.c.appId, redirect_uri: p.redirectUri, state: p.state, response_type: 'code', scope: p.scopes.join(',') });
    return `${this.c.oauthUrl}/${this.c.version}/dialog/oauth?${q}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const r = await this.call<{ access_token: string }>('oauth/access_token', { query: { client_id: this.c.appId, client_secret: this.c.appSecret, redirect_uri: redirectUri, code } });
    return r.access_token;
  }

  /** Token de usuário de longa duração (~60 dias). Os tokens de Página derivados dele não expiram. */
  async longLived(userToken: string): Promise<string> {
    const r = await this.call<{ access_token: string }>('oauth/access_token', { query: { grant_type: 'fb_exchange_token', client_id: this.c.appId, client_secret: this.c.appSecret, fb_exchange_token: userToken } });
    return r.access_token;
  }

  async listPages(userToken: string): Promise<PageInfo[]> {
    const r = await this.call<{ data: PageInfo[] }>('me/accounts', {
      token: userToken, query: { fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}', limit: '100' },
    });
    return r.data ?? [];
  }

  pageName(pageId: string, token: string) { return this.call<{ id: string; name?: string }>(pageId, { token, query: { fields: 'id,name' } }); }

  // ---------- Facebook ----------
  async publishToPage(pageId: string, token: string, p: { message: string; imageUrls: string[] }): Promise<{ id: string }> {
    if (p.imageUrls.length === 1) {
      const r = await this.call<{ id: string; post_id?: string }>(`${pageId}/photos`, { method: 'POST', token, body: { url: p.imageUrls[0], caption: p.message, published: true } });
      return { id: r.post_id ?? r.id };
    }
    // Várias fotos: envia cada uma sem publicar e depois cria um único post com todas anexadas.
    const ids: string[] = [];
    for (const url of p.imageUrls) ids.push((await this.call<{ id: string }>(`${pageId}/photos`, { method: 'POST', token, body: { url, published: false } })).id);
    const post = await this.call<{ id: string }>(`${pageId}/feed`, { method: 'POST', token, body: { message: p.message, attached_media: ids.map((media_fbid) => ({ media_fbid })) } });
    return { id: post.id };
  }

  async facebookPermalink(postId: string, token: string) {
    try { return (await this.call<{ permalink_url?: string }>(postId, { token, query: { fields: 'permalink_url' } })).permalink_url ?? null; } catch { return null; }
  }

  // ---------- Instagram ----------
  private async waitContainer(id: string, token: string) {
    for (let i = 0; i < 20; i++) {
      const s = await this.call<{ status_code?: string }>(id, { token, query: { fields: 'status_code' } });
      if (s.status_code === 'FINISHED' || s.status_code === undefined) return;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new SocialApiError('O Instagram não conseguiu processar as imagens (formato ou proporção não aceitos).', 9999, 400);
      await wait(this.c.pollMs);
    }
    throw new SocialApiError('O Instagram demorou demais para processar as imagens.', 2, 504);
  }

  async publishToInstagram(igId: string, token: string, p: { caption: string; imageUrls: string[] }): Promise<{ id: string }> {
    let creation: string;
    if (p.imageUrls.length === 1) {
      creation = (await this.call<{ id: string }>(`${igId}/media`, { method: 'POST', token, body: { image_url: p.imageUrls[0], caption: p.caption } })).id;
    } else {
      const children: string[] = [];
      for (const url of p.imageUrls) {
        const c = await this.call<{ id: string }>(`${igId}/media`, { method: 'POST', token, body: { image_url: url, is_carousel_item: true } });
        await this.waitContainer(c.id, token);
        children.push(c.id);
      }
      creation = (await this.call<{ id: string }>(`${igId}/media`, { method: 'POST', token, body: { media_type: 'CAROUSEL', children: children.join(','), caption: p.caption } })).id;
    }
    await this.waitContainer(creation, token);
    return this.call<{ id: string }>(`${igId}/media_publish`, { method: 'POST', token, body: { creation_id: creation } });
  }

  async instagramPermalink(mediaId: string, token: string) {
    try { return (await this.call<{ permalink?: string }>(mediaId, { token, query: { fields: 'permalink' } })).permalink ?? null; } catch { return null; }
  }
}
