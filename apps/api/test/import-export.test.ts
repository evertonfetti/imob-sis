import ExcelJS from 'exceljs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, bootApp, login, resetAndSeed } from './helpers';

let app: NestFastifyApplication;
let admin: { accessToken: string };

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload: payload as never });

/** Cria uma planilha .xlsx a partir de um cabeçalho e linhas (array de objetos) — o mesmo formato que um usuário exportaria e reimportaria. */
async function sheet(headers: string[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados');
  ws.columns = headers.map((h) => ({ header: h, key: h }));
  ws.addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function readSheet(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0]!;
  const headers: string[] = [];
  ws.getRow(1).eachCell((c, i) => { headers[i] = c.text; });
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, line) => {
    if (line === 1) return;
    const r: Record<string, string> = {};
    row.eachCell((c, i) => { if (headers[i]) r[headers[i]!] = c.text; });
    rows.push(r);
  });
  return { headers: headers.filter(Boolean), rows };
}

/** Fluxo completo: URL assinada → envio do arquivo → confirmação (mesmo padrão do upload de fotos). */
async function doImport(basePath: string, buf: Buffer) {
  const target = await call('POST', `${basePath}/import/upload-url`, admin.accessToken, { sizeBytes: buf.length });
  expect(target.statusCode).toBe(200);
  const { uploadUrl, key } = target.json();
  const u = new URL(uploadUrl);
  const put = await app.inject({ method: 'PUT', url: u.pathname + u.search, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, payload: buf });
  expect(put.statusCode).toBe(200);
  return call('POST', `${basePath}/import`, admin.accessToken, { key });
}

beforeAll(async () => {
  await resetAndSeed();
  app = await bootApp();
  admin = (await login(app, 'admin.a@teste.com')).body;
});
afterAll(async () => { await app.close(); });

describe('exportar/importar em planilha', () => {
  it('proprietários: exporta, importa (cria e atualiza pelo documento) e relata erro sem travar a planilha', async () => {
    const buf = await sheet(['Tipo', 'Nome', 'Documento', 'E-mail', 'Telefone'], [
      { Tipo: 'Pessoa física', Nome: 'Maria Migrada', Documento: '111.222.333-44', 'E-mail': 'maria@teste.com', Telefone: '17999990000' },
      { Tipo: 'Tipo Inválido', Nome: 'Linha Ruim', Documento: '', 'E-mail': '', Telefone: '' },
    ]);
    const r = await doImport('/owners', buf);
    expect(r.statusCode).toBe(200);
    const result = r.json();
    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/não reconhecido/);

    const list = (await call('GET', '/owners?pageSize=50', admin.accessToken)).json();
    const maria = list.items.find((o: { name: string }) => o.name === 'Maria Migrada');
    expect(maria).toMatchObject({ email: 'maria@teste.com' });

    // Reimportar a MESMA planilha, com o e-mail alterado, atualiza em vez de duplicar.
    const buf2 = await sheet(['Tipo', 'Nome', 'Documento', 'E-mail'], [{ Tipo: 'Pessoa física', Nome: 'Maria Migrada', Documento: '111.222.333-44', 'E-mail': 'maria.nova@teste.com' }]);
    const r2 = await doImport('/owners', buf2);
    expect(r2.json()).toMatchObject({ created: 0, updated: 1 });
    const list2 = (await call('GET', '/owners?pageSize=50', admin.accessToken)).json();
    expect(list2.items.find((o: { id: string }) => o.id === maria.id)).toMatchObject({ email: 'maria.nova@teste.com' });

    const exp = await call('GET', '/owners/export', admin.accessToken);
    expect(exp.statusCode).toBe(200);
    const parsed = await readSheet(exp.rawPayload);
    expect(parsed.headers).toContain('Documento');
    expect(parsed.rows.some((row) => row['Nome'] === 'Maria Migrada')).toBe(true);
  });

  it('clientes: reconhece quem já existe pelo telefone', async () => {
    const buf = await sheet(['Nome', 'Telefone', 'E-mail'], [{ Nome: 'Cliente Planilha', Telefone: '(17) 98888-7777', 'E-mail': '' }]);
    expect((await doImport('/customers', buf)).json()).toMatchObject({ created: 1, updated: 0 });

    const buf2 = await sheet(['Nome', 'Telefone', 'Documento'], [{ Nome: 'Cliente Planilha Ltda', Telefone: '17988887777', Documento: '00.000.000/0001-00' }]);
    expect((await doImport('/customers', buf2)).json()).toMatchObject({ created: 0, updated: 1 });
  });

  it('imóveis: cria (com tipo novo criado sozinho e proprietário resolvido), atualiza pelo código, e erra sem travar a planilha', async () => {
    await call('POST', '/owners', admin.accessToken, { type: 'PERSON', name: 'Dono Planilha', document: '999.888.777-66' });

    const buf = await sheet(
      ['Título', 'Tipo', 'Finalidade', 'Valor de venda', 'Cidade', 'Bairro', 'Proprietário (nome ou documento)'],
      [
        { Título: 'Casa importada', Tipo: 'Chácara', Finalidade: 'Venda', 'Valor de venda': 450000, Cidade: 'Rio Preto', Bairro: 'Centro', 'Proprietário (nome ou documento)': '999.888.777-66' },
        { Título: 'Linha com finalidade errada', Tipo: 'Apartamento', Finalidade: 'Sei lá', 'Valor de venda': 100000, Cidade: 'X', Bairro: 'Y', 'Proprietário (nome ou documento)': '' },
      ],
    );
    const r = await doImport('/properties', buf);
    const result = r.json();
    expect(result).toMatchObject({ created: 1, updated: 0 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/Finalidade/);

    const types = (await call('GET', '/property-types', admin.accessToken)).json();
    expect(types.some((t: { name: string }) => t.name === 'Chácara')).toBe(true);

    const list = (await call('GET', '/properties?search=Casa importada', admin.accessToken)).json();
    const created = list.items[0];
    expect(created).toMatchObject({ title: 'Casa importada', city: 'Rio Preto' });

    // Reimportar pelo código muda os dados sem criar um segundo imóvel.
    const buf2 = await sheet(['Código', 'Título', 'Valor de venda'], [{ Código: created.code, Título: 'Casa importada', 'Valor de venda': 500000 }]);
    const r2 = await doImport('/properties', buf2);
    expect(r2.json()).toMatchObject({ created: 0, updated: 1 });
    const after = (await call('GET', `/properties/${created.id}`, admin.accessToken)).json();
    expect(after.salePrice).toBe(500000);

    const exp = await call('GET', '/properties/export', admin.accessToken);
    expect(exp.statusCode).toBe(200);
    const parsed = await readSheet(exp.rawPayload);
    expect(parsed.rows.some((row) => row['Código'] === created.code && row['Valor de venda'] === '500000')).toBe(true);
  });

  it('recusa planilha vazia e chave de outra empresa', async () => {
    const buf = await sheet(['Nome'], []);
    const r = await doImport('/owners', buf);
    expect(r.json().code).toBe('IMPORT_EMPTY');

    const r2 = await call('POST', '/owners/import', admin.accessToken, { key: 'outra-empresa/imports/x.xlsx' });
    expect(r2.statusCode).toBe(400);
  });
});
