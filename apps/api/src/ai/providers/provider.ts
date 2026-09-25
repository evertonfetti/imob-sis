import type { AiOperation } from '@imob/types';

/** Erro de provedor com mensagem já pronta para o usuário. `retryable` = vale tentar de novo mais tarde. */
export class AiProviderError extends Error {
  constructor(message: string, public readonly status?: number, public readonly kind: 'auth' | 'limit' | 'refused' | 'unsupported' | 'other' = 'other') {
    super(message);
  }
}

export interface AiEditInput {
  /** Foto de entrada (JPEG/PNG). */
  image: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  /** Texto livre do usuário (ex.: o que remover) ou estilo da decoração. */
  prompt?: string | null;
  style?: string | null;
}
export interface AiEditResult { image: Buffer; model: string | null; costUsd: number }

/**
 * Abstração de IA de imagem (spec §21): o sistema nunca fala com um fornecedor específico.
 * Cada método devolve uma NOVA imagem; a foto original nunca é alterada.
 */
export interface AIImageProvider {
  readonly id: string;
  supports(op: AiOperation): boolean;
  enhance(i: AiEditInput): Promise<AiEditResult>;
  improveLighting(i: AiEditInput): Promise<AiEditResult>;
  removeObject(i: AiEditInput): Promise<AiEditResult>;
  removeFurniture(i: AiEditInput): Promise<AiEditResult>;
  virtualStage(i: AiEditInput): Promise<AiEditResult>;
  replaceSky(i: AiEditInput): Promise<AiEditResult>;
  /** Confere se a chave é aceita (sem gerar imagem nem custo). */
  check?(): Promise<void>;
}

export function run(p: AIImageProvider, op: AiOperation, i: AiEditInput): Promise<AiEditResult> {
  switch (op) {
    case 'ENHANCE': return p.enhance(i);
    case 'LIGHTING': return p.improveLighting(i);
    case 'REMOVE_OBJECT': return p.removeObject(i);
    case 'REMOVE_FURNITURE': return p.removeFurniture(i);
    case 'VIRTUAL_STAGE': return p.virtualStage(i);
    case 'SKY_REPLACEMENT': return p.replaceSky(i);
  }
}
