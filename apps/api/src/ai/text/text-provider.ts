import { AiProviderError } from '../providers/provider';
import { httpError } from '../providers/prompt-provider';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatInput { system: string; messages: ChatMessage[]; json?: boolean }
export interface ChatResult { text: string; inputTokens: number; outputTokens: number }
export interface TextConfig { baseUrl: string; apiKey: string; model: string; timeoutMs: number }

/** Abstração de IA de texto (conversa): o agente nunca fala com um fornecedor específico. */
export interface AITextProvider { readonly id: string; chat(i: ChatInput): Promise<ChatResult> }

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    .catch((e) => { throw new AiProviderError(`Sem conexão com o provedor de IA (${(e as Error).message}).`); });
  const json: any = await res.json().catch(() => ({}));
  return { res, json };
}

export class OpenAiText implements AITextProvider {
  readonly id = 'openai';
  constructor(private readonly c: TextConfig) {}

  async chat(i: ChatInput): Promise<ChatResult> {
    const base = { model: this.c.model, messages: [{ role: 'system', content: i.system }, ...i.messages] };
    const call = (extra: object) => post(`${this.c.baseUrl}/chat/completions`, { authorization: `Bearer ${this.c.apiKey}` }, { ...base, ...extra }, this.c.timeoutMs);
    let { res, json } = await call(i.json ? { response_format: { type: 'json_object' } } : {});
    // Alguns modelos não aceitam response_format: repete sem ele (o prompt já exige JSON).
    if (!res.ok && res.status === 400 && i.json && /response_format/i.test(json?.error?.message ?? '')) ({ res, json } = await call({}));
    if (!res.ok) throw httpError(res.status, json?.error?.message ?? '');
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new AiProviderError('O provedor não devolveu resposta (pode ter recusado o pedido).', 200, 'refused');
    return { text, inputTokens: Number(json?.usage?.prompt_tokens ?? 0), outputTokens: Number(json?.usage?.completion_tokens ?? 0) };
  }
}

export class GeminiText implements AITextProvider {
  readonly id = 'gemini';
  constructor(private readonly c: TextConfig) {}

  async chat(i: ChatInput): Promise<ChatResult> {
    // A API exige que a conversa comece com o cliente.
    const msgs = [...i.messages];
    while (msgs[0]?.role === 'assistant') msgs.shift();
    const { res, json } = await post(`${this.c.baseUrl}/models/${this.c.model}:generateContent`, { 'x-goog-api-key': this.c.apiKey }, {
      systemInstruction: { parts: [{ text: i.system }] },
      contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      ...(i.json && { generationConfig: { responseMimeType: 'application/json' } }),
    }, this.c.timeoutMs);
    if (!res.ok) throw httpError(res.status, json?.error?.message ?? '');
    const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    if (!text.trim()) throw new AiProviderError('O provedor não devolveu resposta (pode ter recusado o pedido).', 200, 'refused');
    return { text, inputTokens: Number(json?.usageMetadata?.promptTokenCount ?? 0), outputTokens: Number(json?.usageMetadata?.candidatesTokenCount ?? 0) };
  }
}

/** Anthropic (Claude) — Messages API. A resposta vem em blocos de conteúdo; o JSON é pedido no prompt e lido com tolerância. */
export class AnthropicText implements AITextProvider {
  readonly id = 'anthropic';
  constructor(private readonly c: TextConfig) {}

  async chat(i: ChatInput): Promise<ChatResult> {
    // A API exige que a conversa comece com o cliente e alterne os autores.
    const msgs: ChatMessage[] = [];
    for (const m of i.messages) {
      const last = msgs.at(-1);
      if (!msgs.length && m.role === 'assistant') continue;
      if (last && last.role === m.role) last.content += `\n${m.content}`; else msgs.push({ ...m });
    }
    const { res, json } = await post(`${this.c.baseUrl}/messages`, { 'x-api-key': this.c.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: this.c.model, max_tokens: 1024, system: i.system, messages: msgs,
    }, this.c.timeoutMs);
    if (!res.ok) throw httpError(res.status, json?.error?.message ?? '');
    const text = (json?.content ?? []).filter((b: { type?: string }) => b.type === 'text').map((b: { text?: string }) => b.text ?? '').join('');
    if (!text.trim()) throw new AiProviderError('O provedor não devolveu resposta (pode ter recusado o pedido).', 200, 'refused');
    return { text, inputTokens: Number(json?.usage?.input_tokens ?? 0), outputTokens: Number(json?.usage?.output_tokens ?? 0) };
  }
}
