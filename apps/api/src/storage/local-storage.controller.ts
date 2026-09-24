import { Controller, Get, HttpCode, Put, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppException } from '../common/app-exception';
import { Public } from '../common/decorators';
import { StorageService } from './storage.service';

const MIME: Record<string, string> = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

/** Endpoints do driver "local": recebe uploads assinados e serve os arquivos publicados. */
@Controller()
export class LocalStorageController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @SkipThrottle()
  @Put('storage/local/upload')
  @HttpCode(200)
  async upload(@Req() req: FastifyRequest) {
    const q = req.query as Record<string, string>;
    if (this.storage.driver !== 'local' || !q.key || !this.storage.verifyLocalUpload({ key: q.key, exp: q.exp, max: q.max, ct: q.ct, sig: q.sig })) {
      throw new AppException('STORAGE_UPLOAD_INVALID', 403);
    }
    if (req.headers['content-type'] !== q.ct) throw new AppException('MEDIA_TYPE_INVALID', 400);

    const max = Number(q.max);
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) throw new AppException('MEDIA_TOO_LARGE', 413);

    const file = this.storage.localPath(q.key);
    const tmp = `${file}.part`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        cb(bytes > max ? new AppException('MEDIA_TOO_LARGE', 413) : null, chunk);
      },
    });
    try {
      await pipeline(req.body as NodeJS.ReadableStream, limiter, createWriteStream(tmp));
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return { ok: true };
  }

  @Public()
  @SkipThrottle()
  @Get('files/*')
  async serve(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (this.storage.driver !== 'local') return reply.status(404).send();
    const key = decodeURIComponent(req.url.split('?')[0]!.replace(/^\/api\/v1\/files\//, ''));
    let file: string;
    try { file = this.storage.localPath(key); } catch { return reply.status(404).send(); }
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return reply.status(404).send();
    return reply
      .header('content-type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
      .header('content-length', stat.size)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('cross-origin-resource-policy', 'cross-origin') // o painel e o site são outras origens
      .send(createReadStream(file));
  }
}
