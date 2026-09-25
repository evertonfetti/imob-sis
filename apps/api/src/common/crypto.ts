import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** Criptografia autenticada (AES-256-GCM) para segredos guardados no banco. */
export function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'imob-integration-salt', 'integration-secrets-v1', 32));
}

export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptJson<T = Record<string, string>>(payload: string, key: Buffer): T {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Formato de segredo inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')) as T;
}

/** Chave usada para criptografar credenciais: ENCRYPTION_KEY, ou (na falta dela) derivada do JWT_ACCESS_SECRET. */
export const secretKeyFor = (env: { ENCRYPTION_KEY?: string; JWT_ACCESS_SECRET: string }) => deriveKey(env.ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET);
