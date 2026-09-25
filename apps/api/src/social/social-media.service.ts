import { Injectable } from '@nestjs/common';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const MAX_WIDTH = 1440;
const MIN_RATIO = 0.8;  // 4:5 (retrato máximo do Instagram)
const MAX_RATIO = 1.91; // 1.91:1 (paisagem máxima do Instagram)

/** O Instagram só aceita JPEG e proporção entre 4:5 e 1,91:1. Geramos essa versão sob demanda e a guardamos. */
@Injectable()
export class SocialMediaService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  /** URL pública (JPEG) de cada foto, na ordem pedida. */
  async jpegUrls(companyId: string, mediaIds: string[]): Promise<string[]> {
    const rows = await this.prisma.propertyMedia.findMany({ where: { id: { in: mediaIds }, companyId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const urls: string[] = [];
    for (const id of mediaIds) {
      const m = byId.get(id);
      if (!m) throw new Error(`Foto ${id} não encontrada`);
      let key = m.socialKey;
      if (!key) {
        key = await this.generate(m);
        await this.prisma.propertyMedia.update({ where: { id: m.id }, data: { socialKey: key } });
      }
      urls.push(this.storage.publicUrl(key));
    }
    return urls;
  }

  private async generate(m: { id: string; originalKey: string; processedKey: string | null }) {
    const src = await this.storage.read(m.processedKey ?? m.originalKey);
    const meta = await sharp(src).metadata();
    const w = meta.width ?? 1, h = meta.height ?? 1;
    const ratio = w / h;
    let img = sharp(src);
    if (ratio > MAX_RATIO) img = img.extract({ left: Math.round((w - Math.round(h * MAX_RATIO)) / 2), top: 0, width: Math.round(h * MAX_RATIO), height: h });
    else if (ratio < MIN_RATIO) img = img.extract({ left: 0, top: Math.round((h - Math.round(w / MIN_RATIO)) / 2), width: w, height: Math.round(w / MIN_RATIO) });
    const out = await img.resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    const id = path.basename(m.originalKey, path.extname(m.originalKey));
    const key = `${m.originalKey.split('/original/')[0]}/social/${id}.jpg`;
    await this.storage.write(key, out, 'image/jpeg');
    return key;
  }
}
