import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, login, resetAndSeed } from './helpers';

let app: NestFastifyApplication;

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

describe('autenticação', () => {
  it('login válido retorna tokens e usuário com permissões', async () => {
    const { res, body } = await login(app, 'admin.a@teste.com');
    expect(res.statusCode).toBe(200);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.role.key).toBe('ADMIN');
    expect(body.user.permissions).toContain('admin.users');
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('login inválido retorna 401 com código e requestId', async () => {
    const { res, body } = await login(app, 'admin.a@teste.com', 'errada12345');
    expect(res.statusCode).toBe(401);
    expect(body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(body.requestId).toBeTruthy();
  });

  it('refresh rotaciona o token; reutilizar o antigo derruba a sessão', async () => {
    const { body: first } = await login(app, 'admin.a@teste.com');
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const second = r1.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    // o token novo também foi revogado por suspeita de roubo
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: second.refreshToken } });
    expect(r2.statusCode).toBe(401);
  });

  it('rota protegida sem token retorna 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(401);
  });
});

describe('CORS', () => {
  it('libera preflight de PATCH, DELETE e PUT para a origem do painel e bloqueia outras', async () => {
    for (const method of ['PATCH', 'DELETE', 'PUT']) {
      const res = await app.inject({
        method: 'OPTIONS', url: '/api/v1/users/x',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type' },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-methods']).toContain(method);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    }
    const other = await app.inject({ method: 'OPTIONS', url: '/api/v1/users/x', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PATCH' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('RBAC', () => {
  it('sem permissão → 403; com permissão → 200', async () => {
    const { body: broker } = await login(app, 'broker.a@teste.com');
    const denied = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(broker.accessToken) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('AUTH_FORBIDDEN');

    const { body: admin } = await login(app, 'admin.a@teste.com');
    const ok = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(admin.accessToken) });
    expect(ok.statusCode).toBe(200);
  });

  it('usuário desativado perde acesso imediatamente', async () => {
    const { body: admin } = await login(app, 'admin.a@teste.com');
    const { body: broker } = await login(app, 'broker.a@teste.com');
    const list = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(admin.accessToken) });
    const target = list.json().items.find((u: { email: string }) => u.email === 'broker.a@teste.com');
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/users/${target.id}`, headers: auth(admin.accessToken) });
    expect(del.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(broker.accessToken) });
    expect(me.statusCode).toBe(403);
  });
});

describe('multiempresa', () => {
  it('admin da empresa A não enxerga nem altera usuários da empresa B', async () => {
    const { body: adminA } = await login(app, 'admin.a@teste.com');
    const { body: adminB } = await login(app, 'admin.b@teste.com');

    const listB = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(adminB.accessToken) });
    const brokerB = listB.json().items.find((u: { email: string }) => u.email === 'broker.b@teste.com');

    const get = await app.inject({ method: 'GET', url: `/api/v1/users/${brokerB.id}`, headers: auth(adminA.accessToken) });
    expect(get.statusCode).toBe(404);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${brokerB.id}`,
      headers: auth(adminA.accessToken),
      payload: { name: 'Invadido' },
    });
    expect(patch.statusCode).toBe(404);

    const listA = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(adminA.accessToken) });
    expect(listA.json().items.every((u: { companyId: string }) => u.companyId === adminA.user.companyId)).toBe(true);
  });

  it('auditoria e filiais são isoladas por empresa', async () => {
    const { body: adminA } = await login(app, 'admin.a@teste.com');
    const { body: adminB } = await login(app, 'admin.b@teste.com');
    await app.inject({ method: 'POST', url: '/api/v1/branches', headers: auth(adminA.accessToken), payload: { name: 'Filial Norte' } });

    const branchesB = await app.inject({ method: 'GET', url: '/api/v1/branches', headers: auth(adminB.accessToken) });
    expect(branchesB.json()).toHaveLength(0);

    const auditB = await app.inject({ method: 'GET', url: '/api/v1/audit-logs', headers: auth(adminB.accessToken) });
    const items = auditB.json().items as { entity: string; companyId: string }[];
    expect(items.every((i) => i.companyId === adminB.user.companyId)).toBe(true);
    expect(items.some((i) => i.entity === 'BRANCH')).toBe(false);
  });
});

describe('auditoria', () => {
  it('registra login e alterações de usuário com before/after', async () => {
    const { body: admin } = await login(app, 'admin.a@teste.com');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(admin.accessToken),
      payload: { name: 'Nova Pessoa', email: 'nova@teste.com', roleKey: 'ATTENDANT', password: 'Senha@12345' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('passwordHash');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.json().id}`,
      headers: auth(admin.accessToken),
      payload: { name: 'Nova Pessoa Editada' },
    });
    const logs = await app.inject({ method: 'GET', url: '/api/v1/audit-logs?entity=USER', headers: auth(admin.accessToken) });
    const update = logs.json().items.find((l: { action: string }) => l.action === 'UPDATE');
    expect(update.before).toEqual({ name: 'Nova Pessoa' });
    expect(update.after).toEqual({ name: 'Nova Pessoa Editada' });
    expect(JSON.stringify(logs.json())).not.toContain('passwordHash');
  });
});
