import { AI_KNOWN_COSTS, type AiModelKind, type AiProviderId, type AiTier, type DiscoveredModelDto } from '@imob/types';
import { AiProviderError } from './provider';
import { httpError } from './prompt-provider';

interface Raw { id: string; label: string; guess: AiModelKind | 'OTHER' }

const OPENAI_IMAGE = /^(gpt-image|chatgpt-image)/; // dall-e não edita fotos: fica em "outros"
const OPENAI_NOT_TEXT = /(embedding|whisper|tts|transcribe|audio|realtime|moderation|davinci|babbage|search|codex|computer-use|sora|instruct|diarize)/;
const GEMINI_NOT_TEXT = /(image|imagen|tts|audio|live|embedding|robotics|computer-use|aqa|veo|native-audio|learnlm)/;

/** Palpite de nível pelo nome (mini/lite = econômico; pro/opus/o-series = premium). O usuário pode ajustar. */
export function guessTier(model: string, kind: AiModelKind | 'OTHER'): AiTier {
  const word = (re: string) => new RegExp(`(^|[-_.:/])(${re})($|[-_.:/])`).test(model); // palavra inteira: "gemini" não conta como "mini"
  if (word('mini|nano|lite|haiku|small|flash-lite')) return 'ECONOMIC';
  if (kind === 'IMAGE') return /(^|[-_])(1\.5|pro)($|[-_])|3\.\d-pro/.test(model) ? 'PREMIUM' : 'STANDARD';
  if (word('pro|opus|ultra|o\\d') || /gpt-5(\.\d+)?$|gpt-4\.5|(^|[-_])(70b|120b|405b|maverick)/.test(model)) return 'PREMIUM';
  if (/(^|[-_.])(8b|instant|scout)($|[-_.])/.test(model)) return 'ECONOMIC';
  return 'STANDARD';
}

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }).catch((e) => { throw new AiProviderError(`Sem conexão com o provedor de IA (${(e as Error).message}).`); });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, json?.error?.message ?? '');
  return json;
}

async function listOpenAi(base: string, key: string): Promise<Raw[]> {
  const json = await getJson(`${base}/models`, { authorization: `Bearer ${key}` });
  const ids: string[] = (json?.data ?? []).map((m: { id: string }) => m.id).filter(Boolean);
  const set = new Set(ids);
  return ids
    // Ignora versões datadas (gpt-4o-2024-08-06) quando o nome sem data existe: são o mesmo modelo.
    .filter((id) => !(/-\d{4}-\d{2}-\d{2}$/.test(id) && set.has(id.replace(/-\d{4}-\d{2}-\d{2}$/, ''))))
    .map((id): Raw => ({ id, label: id, guess: OPENAI_IMAGE.test(id) ? 'IMAGE' : OPENAI_NOT_TEXT.test(id) ? 'OTHER' : /^(gpt-|o\d|chatgpt-)/.test(id) ? 'TEXT' : 'OTHER' }));
}

async function listGemini(base: string, key: string): Promise<Raw[]> {
  const out: Raw[] = [];
  let token = '';
  for (let page = 0; page < 5; page++) {
    const json = await getJson(`${base}/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { 'x-goog-api-key': key });
    for (const m of json?.models ?? []) {
      const id = String(m.name ?? '').replace(/^models\//, '');
      if (!id) continue;
      const methods: string[] = m.supportedGenerationMethods ?? [];
      const generates = methods.includes('generateContent');
      out.push({ id, label: m.displayName || id, guess: !generates ? 'OTHER' : /image/.test(id) && !/imagen/.test(id) ? 'IMAGE' : GEMINI_NOT_TEXT.test(id) ? 'OTHER' : 'TEXT' });
    }
    token = json?.nextPageToken ?? '';
    if (!token) break;
  }
  return out;
}

const GROQ_NOT_TEXT = /(whisper|tts|guard|playai|orpheus|embed|transcri)/;

async function listAnthropic(base: string, key: string): Promise<Raw[]> {
  const out: Raw[] = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const json = await getJson(`${base}/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    for (const m of json?.data ?? []) if (m.id) out.push({ id: m.id, label: m.display_name || m.id, guess: 'TEXT' });
    if (!json?.has_more || !json?.last_id) break;
    after = json.last_id;
  }
  return out;
}

async function listGroq(base: string, key: string): Promise<Raw[]> {
  const json = await getJson(`${base}/models`, { authorization: `Bearer ${key}` });
  return (json?.data ?? []).filter((m: { id?: string; active?: boolean }) => m.id && m.active !== false)
    .map((m: { id: string }): Raw => ({ id: m.id, label: m.id, guess: GROQ_NOT_TEXT.test(m.id) ? 'OTHER' : 'TEXT' }));
}

/** Lista os modelos que a conta pode usar (e, de quebra, prova que a chave vale). */
export async function discoverModels(provider: AiProviderId, base: string, apiKey: string): Promise<DiscoveredModelDto[]> {
  const raw = provider === 'gemini' ? await listGemini(base, apiKey) : provider === 'anthropic' ? await listAnthropic(base, apiKey) : provider === 'groq' ? await listGroq(base, apiKey) : await listOpenAi(base, apiKey);
  const order = { IMAGE: 0, TEXT: 1, OTHER: 2 } as const;
  return raw
    .sort((a, b) => order[a.guess] - order[b.guess] || a.id.localeCompare(b.id))
    .map((r): DiscoveredModelDto => {
      const known = AI_KNOWN_COSTS.find((k) => k.match.test(r.id));
      return { model: r.id, label: r.label, guess: r.guess, tier: guessTier(r.id, r.guess), costUsd: known?.costUsd ?? 0, inputCostPerMTok: known?.inputCostPerMTok ?? null, outputCostPerMTok: known?.outputCostPerMTok ?? null, added: false };
    });
}
