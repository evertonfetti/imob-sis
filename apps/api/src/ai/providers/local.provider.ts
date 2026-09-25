import sharp from 'sharp';
import type { AiOperation } from '@imob/types';
import { AiProviderError, type AIImageProvider, type AiEditInput, type AiEditResult } from './provider';

const unsupported = (): never => { throw new AiProviderError('Esta edição precisa de um provedor de IA (Google Gemini ou OpenAI).', 400, 'unsupported'); };

/**
 * Modo básico, executado no próprio servidor (sem custo e sem chave): melhora de foto e de iluminação por processamento
 * de imagem. Edições que "inventam" pixels (remover objeto, esvaziar, decorar, trocar céu) exigem um provedor generativo.
 */
export class LocalProvider implements AIImageProvider {
  readonly id = 'local';
  supports(op: AiOperation) { return op === 'ENHANCE' || op === 'LIGHTING'; }

  async enhance(i: AiEditInput): Promise<AiEditResult> {
    const image = await sharp(i.image).rotate().normalise({ lower: 2, upper: 98 }).modulate({ saturation: 1.12 }).sharpen({ sigma: 1.1 }).jpeg({ quality: 92 }).toBuffer();
    return { image, model: 'local-sharp', costUsd: 0 };
  }

  async improveLighting(i: AiEditInput): Promise<AiEditResult> {
    // Clareia sombras (curva gama) e reequilibra o contraste sem estourar as luzes.
    const image = await sharp(i.image).rotate().gamma(1.5).normalise({ lower: 1, upper: 99 }).modulate({ brightness: 1.03 }).jpeg({ quality: 92 }).toBuffer();
    return { image, model: 'local-sharp', costUsd: 0 };
  }

  removeObject = async (_i: AiEditInput): Promise<AiEditResult> => unsupported();
  removeFurniture = async (_i: AiEditInput): Promise<AiEditResult> => unsupported();
  virtualStage = async (_i: AiEditInput): Promise<AiEditResult> => unsupported();
  replaceSky = async (_i: AiEditInput): Promise<AiEditResult> => unsupported();
}
