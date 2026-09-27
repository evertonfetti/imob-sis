import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura dos webhooks do Mercado Pago: cabeçalho `x-signature: ts=...,v1=...`.
 * Manifesto: `id:{data.id};request-id:{x-request-id};ts:{ts};` (id sempre em minúsculas), HMAC-SHA256 com o
 * segredo configurado na integração da sua conta Mercado Pago. Documentação oficial (consultada via ctx7):
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks
 */
export function mpManifest(dataId: string, requestId: string | undefined, ts: string): string {
  const parts = [`id:${dataId.toLowerCase()}`];
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return parts.join(';') + ';';
}

export function verifyMpSignature(input: { xSignature: string | undefined; xRequestId: string | undefined; dataId: string; secret: string }): boolean {
  if (!input.xSignature || !input.dataId) return false;
  let ts: string | undefined;
  let hash: string | undefined;
  for (const part of input.xSignature.split(',')) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (key === 'ts') ts = value;
    if (key === 'v1') hash = value;
  }
  if (!ts || !hash) return false;
  const manifest = mpManifest(input.dataId, input.xRequestId, ts);
  const computed = createHmac('sha256', input.secret).update(manifest).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
