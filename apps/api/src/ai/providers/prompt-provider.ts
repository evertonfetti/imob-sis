import { STAGING_STYLES } from '@imob/types';
import { AiProviderError, type AIImageProvider, type AiEditInput, type AiEditResult } from './provider';
import { PROMPTS } from './prompts';
import type { AiOperation } from '@imob/types';

const STYLE_EN: Record<string, string> = { moderno: 'modern', classico: 'classic', escandinavo: 'Scandinavian', industrial: 'industrial', minimalista: 'minimalist', rustico: 'rustic' };

/** Base dos provedores generativos: cada operação vira uma instrução e um único método `edit`. */
export abstract class PromptImageProvider implements AIImageProvider {
  abstract readonly id: string;
  protected abstract edit(prompt: string, i: AiEditInput): Promise<AiEditResult>;
  supports(_op: AiOperation) { return true; }

  enhance(i: AiEditInput) { return this.edit(PROMPTS.enhance(), i); }
  improveLighting(i: AiEditInput) { return this.edit(PROMPTS.lighting(), i); }
  removeObject(i: AiEditInput) {
    if (!i.prompt?.trim()) throw new AiProviderError('Descreva o que deve ser removido.', 400, 'refused');
    return this.edit(PROMPTS.removeObject(i.prompt.trim()), i);
  }
  removeFurniture(i: AiEditInput) { return this.edit(PROMPTS.removeFurniture(), i); }
  virtualStage(i: AiEditInput) {
    const style = STAGING_STYLES.includes(i.style as never) ? STYLE_EN[i.style!]! : 'modern';
    return this.edit(PROMPTS.virtualStage(style) + (i.prompt?.trim() ? ` Additional request: ${i.prompt.trim()}.` : ''), i);
  }
  replaceSky(i: AiEditInput) { return this.edit(PROMPTS.replaceSky(), i); }
}

/** Traduz falhas HTTP dos provedores em mensagens claras. */
export function httpError(status: number, detail: string): AiProviderError {
  if (status === 401 || status === 403) return new AiProviderError('O provedor recusou a chave de acesso. Confira a chave em Empresa → Imagens e IA.', status, 'auth');
  if (status === 429) return new AiProviderError('O provedor de IA atingiu o limite de uso ou de cobrança. Tente novamente em alguns minutos.', status, 'limit');
  if (status === 400 && /safety|policy|moderation|blocked|refus/i.test(detail)) return new AiProviderError('O provedor recusou este pedido por política de conteúdo. Tente descrever de outra forma.', status, 'refused');
  if (status >= 500) return new AiProviderError('O provedor de IA está instável no momento. Tente novamente.', status, 'other');
  return new AiProviderError(`O provedor de IA não conseguiu processar o pedido${detail ? `: ${detail.slice(0, 160)}` : '.'}`, status, 'other');
}
