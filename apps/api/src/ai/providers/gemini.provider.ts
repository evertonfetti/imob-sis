import { httpError, PromptImageProvider } from './prompt-provider';
import { AiProviderError, type AiEditInput, type AiEditResult } from './provider';

export interface HttpConfig { baseUrl: string; apiKey: string; model: string; timeoutMs: number; costUsd: number }

/** Procura em qualquer formato de resposta do Gemini (interactions ou generateContent) o primeiro bloco de imagem. */
export function findImage(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  const data = o.data;
  const mime = String(o.mime_type ?? o.mimeType ?? '');
  if (typeof data === 'string' && data.length > 200 && (mime.startsWith('image/') || o.type === 'image')) return data;
  for (const v of Object.values(o)) {
    const r = findImage(v);
    if (r) return r;
  }
  return null;
}

/** Google Gemini (edição de imagem por instrução). API "interactions" documentada em ai.google.dev. */
export class GeminiProvider extends PromptImageProvider {
  readonly id = 'gemini';
  constructor(private readonly c: HttpConfig) { super(); }

  protected async edit(prompt: string, i: AiEditInput): Promise<AiEditResult> {
    const res = await fetch(`${this.c.baseUrl}/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.c.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.c.model, input: [{ type: 'text', text: prompt }, { type: 'image', mime_type: i.mimeType, data: i.image.toString('base64') }] }),
      signal: AbortSignal.timeout(this.c.timeoutMs),
    }).catch((e) => { throw new AiProviderError(`Sem conexão com o provedor de IA (${(e as Error).message}).`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(res.status, json?.error?.message ?? '');
    const b64 = findImage(json);
    if (!b64) throw new AiProviderError('O provedor não devolveu uma imagem (pode ter recusado o pedido). Tente descrever de outra forma.', 200, 'refused');
    return { image: Buffer.from(b64, 'base64'), model: this.c.model, costUsd: this.c.costUsd };
  }

  async check() {
    const res = await fetch(`${this.c.baseUrl}/models?pageSize=1`, { headers: { 'x-goog-api-key': this.c.apiKey }, signal: AbortSignal.timeout(15_000) })
      .catch((e) => { throw new AiProviderError(`Sem conexão com o provedor de IA (${(e as Error).message}).`); });
    if (!res.ok) throw httpError(res.status, '');
  }
}
