import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mpManifest, verifyMpSignature } from '../src/billing/signature';

const SECRET = 'segredo';

function sign(dataId: string, requestId: string, ts: string) {
  return createHmac('sha256', SECRET).update(mpManifest(dataId, requestId, ts)).digest('hex');
}

describe('verifyMpSignature', () => {
  it('aceita uma assinatura válida', () => {
    const ts = '1700000000';
    const v1 = sign('123456', 'req-1', ts);
    expect(verifyMpSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: '123456', secret: SECRET })).toBe(true);
  });

  it('o id do pagamento entra sempre em minúsculas no manifesto', () => {
    const ts = '1700000000';
    const v1 = sign('abc123', 'req-1', ts); // assinado com o id já minúsculo
    expect(verifyMpSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: 'ABC123', secret: SECRET })).toBe(true);
  });

  it('recusa quando o hash não bate (payload adulterado ou segredo errado)', () => {
    const ts = '1700000000';
    const v1 = sign('123456', 'req-1', ts);
    expect(verifyMpSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: '999999', secret: SECRET })).toBe(false);
    expect(verifyMpSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: '123456', secret: 'segredo-errado' })).toBe(false);
  });

  it('recusa cabeçalho ausente ou malformado', () => {
    expect(verifyMpSignature({ xSignature: undefined, xRequestId: 'req-1', dataId: '1', secret: SECRET })).toBe(false);
    expect(verifyMpSignature({ xSignature: 'ts=123', xRequestId: 'req-1', dataId: '1', secret: SECRET })).toBe(false); // sem v1
  });
});
