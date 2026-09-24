import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ENV, Env } from '../config/env';

export interface UploadTarget {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/**
 * Storage com dois drivers:
 *  - s3:    S3 / Cloudflare R2 / MinIO. O browser envia direto ao storage por URL assinada.
 *  - local: disco (volume). Funciona sem configurar nada; o envio passa pela API por URL assinada.
 * O driver S3 é usado quando S3_ENDPOINT e as chaves estão definidos (ou STORAGE_DRIVER=s3).
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage');
  private s3Client?: S3Client;
  readonly driver: 'local' | 's3';
  readonly localDir: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.driver = env.STORAGE_DRIVER ?? (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? 's3' : 'local');
    this.localDir = path.resolve(env.LOCAL_STORAGE_DIR);
    this.log.log(`Driver de storage: ${this.driver}${this.driver === 'local' ? ` (${this.localDir})` : ''}`);
  }

  // ---------- Chaves e URLs ----------
  /** Toda chave começa pela empresa: isolamento entre tenants também no storage. */
  buildKey(companyId: string, propertyId: string, kind: 'original' | 'processed' | 'thumb', id: string, ext: string) {
    return `${companyId}/properties/${propertyId}/${kind}/${id}.${ext}`;
  }

  publicUrl(key: string) {
    if (this.driver === 's3') return `${(this.env.S3_PUBLIC_URL ?? '').replace(/\/$/, '')}/${key}`;
    return `${(this.env.API_PUBLIC_URL ?? '').replace(/\/$/, '')}/api/v1/files/${key}`;
  }

  // ---------- Upload ----------
  async createUpload(opts: { key: string; contentType: string; maxBytes: number; origin: string }): Promise<UploadTarget> {
    if (this.driver === 's3') {
      const uploadUrl = await getSignedUrl(
        this.s3(),
        new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: opts.key, ContentType: opts.contentType }),
        { expiresIn: 900 },
      );
      return { uploadUrl, method: 'PUT', headers: { 'Content-Type': opts.contentType } };
    }
    const exp = Date.now() + 15 * 60_000;
    const sig = this.sign(opts.key, exp, opts.contentType, opts.maxBytes);
    const q = new URLSearchParams({ key: opts.key, exp: String(exp), max: String(opts.maxBytes), ct: opts.contentType, sig });
    return {
      uploadUrl: `${opts.origin.replace(/\/$/, '')}/api/v1/storage/local/upload?${q}`,
      method: 'PUT',
      headers: { 'Content-Type': opts.contentType },
    };
  }

  private sign(key: string, exp: number, contentType: string, maxBytes: number) {
    return createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(`${key}|${exp}|${contentType}|${maxBytes}`).digest('hex');
  }

  /** Valida a assinatura de um envio local (usado pelo endpoint de upload). */
  verifyLocalUpload(p: { key: string; exp: string; max: string; ct: string; sig: string }) {
    const exp = Number(p.exp);
    const max = Number(p.max);
    if (!Number.isFinite(exp) || !Number.isFinite(max) || exp < Date.now()) return false;
    const expected = Buffer.from(this.sign(p.key, exp, p.ct, max));
    const given = Buffer.from(p.sig ?? '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  // ---------- Operações ----------
  /** Caminho local seguro (impede `..` e caminhos absolutos). */
  localPath(key: string) {
    const full = path.resolve(this.localDir, key);
    if (!full.startsWith(this.localDir + path.sep)) throw new Error('Chave de storage inválida');
    return full;
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      if (this.driver === 's3') {
        const r = await this.s3().send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
        return { size: r.ContentLength ?? 0 };
      }
      return { size: (await fs.stat(this.localPath(key))).size };
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Buffer> {
    if (this.driver === 's3') {
      const r = await this.s3().send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return fs.readFile(this.localPath(key));
  }

  async write(key: string, body: Buffer, contentType: string) {
    if (this.driver === 's3') {
      await this.s3().send(new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
      return;
    }
    const file = this.localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  async delete(key: string) {
    try {
      if (this.driver === 's3') await this.s3().send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
      else await fs.rm(this.localPath(key), { force: true });
    } catch (e) {
      this.log.warn(`Não foi possível apagar ${key}: ${(e as Error).message}`);
    }
  }

  private s3() {
    return (this.s3Client ??= new S3Client({
      region: this.env.S3_REGION,
      endpoint: this.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: this.env.S3_ACCESS_KEY && this.env.S3_SECRET_KEY
        ? { accessKeyId: this.env.S3_ACCESS_KEY, secretAccessKey: this.env.S3_SECRET_KEY }
        : undefined,
    }));
  }
}
