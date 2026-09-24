import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppException } from '../common/app-exception';
import { ENV, Env } from '../config/env';

/**
 * Base de storage S3-compatible (R2 / S3 / MinIO).
 * Fluxo de upload: API gera URL assinada → browser envia direto ao storage → API registra a mídia.
 */
@Injectable()
export class StorageService {
  private client?: S3Client;
  constructor(@Inject(ENV) private readonly env: Env) {}

  private s3() {
    return (this.client ??= new S3Client({
      region: this.env.S3_REGION,
      endpoint: this.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials:
        this.env.S3_ACCESS_KEY && this.env.S3_SECRET_KEY
          ? { accessKeyId: this.env.S3_ACCESS_KEY, secretAccessKey: this.env.S3_SECRET_KEY }
          : undefined,
    }));
  }

  /** Chave sempre prefixada pela empresa: isolamento entre tenants também no storage. */
  buildKey(companyId: string, folder: string, filename: string) {
    const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    return `${companyId}/${folder}/${randomUUID()}${ext ? `.${ext}` : ''}`;
  }

  async createUploadUrl(opts: { key: string; contentType: string; allowedTypes: string[]; maxBytes?: number; expiresIn?: number }) {
    if (!opts.allowedTypes.includes(opts.contentType)) {
      throw new AppException('VALIDATION_FAILED', 400, 'Tipo de arquivo não permitido.');
    }
    const url = await getSignedUrl(
      this.s3(),
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: opts.key, ContentType: opts.contentType }),
      { expiresIn: opts.expiresIn ?? 600 },
    );
    return { uploadUrl: url, key: opts.key, publicUrl: this.publicUrl(opts.key) };
  }

  publicUrl(key: string) {
    return `${(this.env.S3_PUBLIC_URL ?? '').replace(/\/$/, '')}/${key}`;
  }

  async delete(key: string) {
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }
}
