import { Injectable, Logger } from '@nestjs/common';
import path from 'node:path';
import sharp from 'sharp';
import { resolveWatermark } from '@imob/types';
import { PrismaService } from '../prisma/prisma.service';
import { stamp } from './watermark';
import { StorageService } from '../storage/storage.service';

const MAX_SIDE = 2400;   // maior lado da versão publicada
const THUMB = { width: 480, height: 360 };

/**
 * Pipeline de imagem: original (ou versão de IA aprovada) → versão otimizada (WebP) + miniatura (WebP).
 */
@Injectable()
export class MediaProcessor {
  private readonly log = new Logger('MediaProcessor');
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  /** Logo da empresa (PNG já normalizado), em cache por chave: a chave muda a cada logo nova. */
  private readonly logos = new Map<string, Buffer>();
  private async logo(key: string) {
    let b = this.logos.get(key);
    if (!b) { b = await this.storage.read(key); if (this.logos.size > 50) this.logos.clear(); this.logos.set(key, b); }
    return b;
  }

  /**
   * Gera a versão publicada (WebP) e a miniatura. A fonte é a versão de IA aprovada, se houver, senão o original —
   * que nunca é alterado nem removido. Com marca d'água ativa, a logo é carimbada na versão publicada e na miniatura.
   * `force` reprocessa uma foto já pronta sem tirá-la do ar: os arquivos antigos só saem depois dos novos estarem gravados.
   */
  async process(mediaId: string, opts: { force?: boolean } = {}) {
    const media = await this.prisma.propertyMedia.findUnique({ where: { id: mediaId } });
    if (!media) return; // removida enquanto esperava na fila
    if (media.status === 'READY' && !opts.force) return;
    if (!opts.force) await this.prisma.propertyMedia.update({ where: { id: mediaId }, data: { status: 'PROCESSING', processingError: null } });

    const company = await this.prisma.company.findUnique({ where: { id: media.companyId }, select: { watermarkSettings: true, watermarkRevision: true, logoKey: true } });
    const wm = resolveWatermark(company?.watermarkSettings);
    const useMark = media.type === 'IMAGE' && wm.enabled && !!company?.logoKey;
    const gen = media.activeGenerationId ? await this.prisma.mediaGeneration.findFirst({ where: { id: media.activeGenerationId, mediaId, status: 'READY' } }) : null;
    const source = await this.storage.read(gen?.outputKey ?? media.originalKey);

    // .rotate() aplica a orientação EXIF; o WebP de saída não carrega metadados (ex.: GPS).
    const resized = await sharp(source, { failOn: 'error' }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    const thumbClean = await sharp(resized.data).resize({ ...THUMB, fit: 'cover', position: 'attention' }).png().toBuffer();
    let full: Buffer = resized.data;
    let thumbSrc: Buffer = thumbClean;
    if (useMark) {
      const logo = await this.logo(company!.logoKey!);
      full = await stamp(full, resized.info.width, resized.info.height, logo, wm);
      thumbSrc = await stamp(thumbClean, THUMB.width, THUMB.height, logo, wm);
    }
    const data = await sharp(full).webp({ quality: 82 }).toBuffer();
    const thumb = await sharp(thumbSrc).webp({ quality: 74 }).toBuffer();

    const id = path.basename(media.originalKey, path.extname(media.originalKey));
    const base = media.originalKey.split('/original/')[0]!;
    const v = Date.now().toString(36); // chave nova a cada versão: navegador e CDN nunca servem a foto antiga
    const processedKey = `${base}/processed/${id}.${v}.webp`;
    const thumbnailKey = `${base}/thumb/${id}.${v}.webp`;
    await this.storage.write(processedKey, data, 'image/webp');
    await this.storage.write(thumbnailKey, thumb, 'image/webp');

    await this.prisma.propertyMedia.update({
      where: { id: mediaId },
      data: {
        status: 'READY', processedKey, thumbnailKey, width: resized.info.width, height: resized.info.height, processingError: null,
        socialKey: null, // a versão JPEG do Instagram é refeita a partir desta
        watermarkRevision: useMark ? (company?.watermarkRevision ?? 0) : null, renderedGenerationId: gen?.id ?? null,
      },
    });
    // Só agora os arquivos da versão anterior podem sair.
    for (const old of [media.processedKey, media.thumbnailKey, media.socialKey]) if (old && old !== processedKey && old !== thumbnailKey) await this.storage.delete(old).catch(() => undefined);
  }

  async markFailed(mediaId: string, error: unknown) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    this.log.error(`Falha ao processar mídia ${mediaId}: ${message}`);
    await this.prisma.propertyMedia.updateMany({ where: { id: mediaId }, data: { status: 'FAILED', processingError: message } });
  }
}
