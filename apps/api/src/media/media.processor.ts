import { Injectable, Logger } from '@nestjs/common';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const MAX_SIDE = 2400;   // maior lado da versão publicada
const THUMB = { width: 480, height: 360 };

/**
 * Pipeline de imagem: original → versão otimizada (WebP) + miniatura (WebP).
 * O arquivo original nunca é alterado nem removido.
 */
@Injectable()
export class MediaProcessor {
  private readonly log = new Logger('MediaProcessor');
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async process(mediaId: string) {
    const media = await this.prisma.propertyMedia.findUnique({ where: { id: mediaId } });
    if (!media) return; // removida enquanto esperava na fila
    if (media.status === 'READY') return;
    await this.prisma.propertyMedia.update({ where: { id: mediaId }, data: { status: 'PROCESSING', processingError: null } });

    const original = await this.storage.read(media.originalKey);
    // .rotate() aplica a orientação EXIF; o WebP de saída não carrega metadados (ex.: GPS).
    const { data, info } = await sharp(original, { failOn: 'error' })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(data).resize({ ...THUMB, fit: 'cover', position: 'attention' }).webp({ quality: 74 }).toBuffer();

    const id = path.basename(media.originalKey, path.extname(media.originalKey));
    const base = media.originalKey.split('/original/')[0]!;
    const processedKey = `${base}/processed/${id}.webp`;
    const thumbnailKey = `${base}/thumb/${id}.webp`;
    await this.storage.write(processedKey, data, 'image/webp');
    await this.storage.write(thumbnailKey, thumb, 'image/webp');

    await this.prisma.propertyMedia.update({
      where: { id: mediaId },
      data: { status: 'READY', processedKey, thumbnailKey, width: info.width, height: info.height, processingError: null },
    });
  }

  async markFailed(mediaId: string, error: unknown) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    this.log.error(`Falha ao processar mídia ${mediaId}: ${message}`);
    await this.prisma.propertyMedia.updateMany({ where: { id: mediaId }, data: { status: 'FAILED', processingError: message } });
  }
}
