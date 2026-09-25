import { httpError, PromptImageProvider } from './prompt-provider';
import { AiProviderError, type AiEditInput, type AiEditResult } from './provider';
import type { HttpConfig } from './gemini.provider';

/** OpenAI gpt-image via POST /images/edits (multipart). */
export class OpenAiProvider extends PromptImageProvider {
  readonly id = 'openai';
  constructor(private readonly c: HttpConfig) { super(); }

  /** A API só aceita alguns tamanhos: escolhe o de proporção mais próxima da foto. */
  static size(w: number, h: number) {
    const r = w / h;
    return r > 1.2 ? '1536x1024' : r < 0.83 ? '1024x1536' : '1024x1024';
  }

  protected async edit(prompt: string, i: AiEditInput): Promise<AiEditResult> {
    const form = new FormData();
    form.set('model', this.c.model);
    form.set('prompt', prompt);
    form.set('size', OpenAiProvider.size(i.width, i.height));
    form.set('quality', 'medium');
    form.set('output_format', 'jpeg');
    if (!/mini/.test(this.c.model)) form.set('input_fidelity', 'high'); // mantém o imóvel fiel ao original
    form.append('image[]', new Blob([new Uint8Array(i.image)], { type: i.mimeType }), i.mimeType === 'image/png' ? 'photo.png' : 'photo.jpg');
    const res = await fetch(`${this.c.baseUrl}/images/edits`, {
      method: 'POST', headers: { authorization: `Bearer ${this.c.apiKey}` }, body: form, signal: AbortSignal.timeout(this.c.timeoutMs),
    }).catch((e) => { throw new AiProviderError(`Sem conexão com o provedor de IA (${(e as Error).message}).`); });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(res.status, `${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`);
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string') throw new AiProviderError('O provedor não devolveu uma imagem. Tente descrever de outra forma.', 200, 'refused');
    return { image: Buffer.from(b64, 'base64'), model: this.c.model, costUsd: this.c.costUsd };
  }

  async check() {
    const res = await fetch(`${this.c.baseUrl}/models`, { headers: { authorization: `Bearer ${this.c.apiKey}` }, signal: AbortSignal.timeout(15_000) })
      .catch((e) => { throw new AiProviderError(`Sem conexão com o provedor de IA (${(e as Error).message}).`); });
    if (!res.ok) throw httpError(res.status, '');
  }
}
