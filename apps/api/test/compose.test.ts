import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(path.resolve(__dirname, '../../../docker-compose.yml'), 'utf8');

/** Trecho de um serviço: da linha "  nome:" até o próximo serviço/seção no mesmo nível. */
function service(name: string) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `serviço ${name} não encontrado`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z]+:\n|\n[a-z]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

// Regressão: edições do compose já falharam em silêncio e deixaram a API sem estas variáveis em produção
// (fotos com links quebrados, formulário do site bloqueado por CORS, uploads fora do volume).
describe('docker-compose.yml de produção', () => {
  it('a api recebe as variáveis de que depende e usa o volume de uploads', () => {
    const api = service('api');
    for (const key of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'ADMIN_URL', 'SITE_URL', 'API_PUBLIC_URL', 'REDIS_URL', 'LOCAL_STORAGE_DIR', 'ENCRYPTION_KEY']) {
      expect(api, `${key} ausente no serviço api`).toMatch(new RegExp(`\\n\\s+${key}:`));
    }
    expect(api).toMatch(/LOCAL_STORAGE_DIR:\s*\/data\/uploads/);
    expect(api).toMatch(/uploads:\/data\/uploads/); // o volume aponta para o mesmo diretório
    expect(api).toMatch(/REDIS_URL:\s*redis:\/\/redis:6379/);
  });

  it('o painel e o site recebem a URL pública da API no build; o site também o SITE_URL', () => {
    expect(service('admin')).toMatch(/VITE_API_URL:\s*\$\{API_PUBLIC_URL\}\/api\/v1/);
    const site = service('website');
    expect(site).toMatch(/NEXT_PUBLIC_API_URL:\s*\$\{API_PUBLIC_URL\}\/api\/v1/);
    expect(site).toMatch(/\n\s+SITE_URL:/);
    expect(site).toMatch(/API_INTERNAL_URL:\s*http:\/\/api:3333\/api\/v1/);
  });

  it('todas as variáveis de ambiente que a API lê e que dependem do deploy estão no compose', () => {
    const env = readFileSync(path.resolve(__dirname, '../src/config/env.ts'), 'utf8');
    const needed = ['API_PUBLIC_URL', 'SITE_URL', 'REDIS_URL', 'LOCAL_STORAGE_DIR', 'ENCRYPTION_KEY', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_PUBLIC_URL'];
    const api = service('api');
    for (const key of needed) {
      expect(env, `${key} não é mais lida pela API`).toContain(key);
      expect(api, `${key} é lida pela API mas não está no compose`).toMatch(new RegExp(`\\n\\s+${key}:`));
    }
  });
});
