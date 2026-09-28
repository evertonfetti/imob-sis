import ExcelJS from 'exceljs';

export interface SheetColumn { header: string; key: string; width?: number }

/** Gera um .xlsx: cabeçalho em negrito na primeira linha, uma linha por registro. */
export async function buildXlsx(sheetName: string, columns: SheetColumn[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 22 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface SheetRow { line: number; cells: Record<string, string> }

/**
 * Lê a primeira planilha do arquivo: linha 1 é o cabeçalho (uma célula por coluna), cada linha seguinte
 * vira um objeto {coluna: texto}. `cell.text` do ExcelJS já resolve número, data e fórmula para string.
 */
export async function readXlsxRows(buf: Buffer): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => { headers[col] = cell.text.trim(); });

  const rows: SheetRow[] = [];
  sheet.eachRow((row, line) => {
    if (line === 1) return;
    const cells: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const text = cell.text.trim();
      cells[key] = text;
      if (text) hasValue = true;
    });
    if (hasValue) rows.push({ line, cells });
  });
  return rows;
}

/** "Sim"/"não"/"true"/"1" → boolean; célula vazia → undefined (não mexe no campo, não força um valor). */
export function cellBool(v: string | undefined): boolean | undefined {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  return ['sim', 's', 'true', '1', 'yes'].includes(s);
}

/** Célula vazia → undefined; número inválido → null (para o chamador decidir se é erro). */
export function cellInt(v: string | undefined): number | null | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function cellFloat(v: string | undefined): number | null | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const cellText = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);
