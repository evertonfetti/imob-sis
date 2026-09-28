import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  IMPORT_MAX_ROWS, customerSchema, updateCustomerSchema,
  type CustomerInput, type ImportConfirmInput, type ImportResultDto, type ImportUploadInput,
} from '@imob/types';
import { AppException } from '../common/app-exception';
import { normalizePhone } from '../common/util';
import type { AuthedCtx } from '../common/request-context';
import { cellText, buildXlsx, readXlsxRows } from '../common/xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CustomersService } from './customers.service';

const HEADERS = ['Nome', 'Telefone', 'E-mail', 'Documento', 'Observações'] as const;

@Injectable()
export class CustomersImportExportService {
  constructor(
    private readonly customers: CustomersService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async export(companyId: string): Promise<Buffer> {
    const rows = await this.prisma.customer.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    return buildXlsx(
      'Clientes',
      HEADERS.map((h) => ({ header: h, key: h })),
      rows.map((c) => ({ Nome: c.name, Telefone: c.phone ?? '', 'E-mail': c.email ?? '', Documento: c.document ?? '', Observações: c.notes ?? '' })),
    );
  }

  template(): Promise<Buffer> {
    return buildXlsx('Clientes', HEADERS.map((h) => ({ header: h, key: h })), []);
  }

  createUpload(companyId: string, input: ImportUploadInput, origin: string) {
    const key = `${companyId}/imports/${randomUUID()}.xlsx`;
    return this.storage
      .createUpload({ key, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', maxBytes: input.sizeBytes, origin })
      .then((t) => ({ key, ...t }));
  }

  async import(ctx: AuthedCtx, input: ImportConfirmInput): Promise<ImportResultDto> {
    const { companyId } = ctx.user;
    if (!input.key.startsWith(`${companyId}/imports/`)) throw new AppException('IMPORT_FILE_INVALID', 400);
    if (!(await this.storage.head(input.key))) throw new AppException('IMPORT_FILE_INVALID', 400);
    let sheetRows: Awaited<ReturnType<typeof readXlsxRows>>;
    try {
      sheetRows = await readXlsxRows(await this.storage.read(input.key));
    } catch {
      throw new AppException('IMPORT_FILE_INVALID', 400);
    } finally {
      await this.storage.delete(input.key).catch(() => undefined);
    }
    if (!sheetRows.length) throw new AppException('IMPORT_EMPTY', 400);
    if (sheetRows.length > IMPORT_MAX_ROWS) throw new AppException('IMPORT_FILE_INVALID', 400, `Máximo de ${IMPORT_MAX_ROWS} linhas por planilha.`);

    // Reconhece um cliente já existente pelo telefone (normalizado) e, sem telefone, pelo e-mail.
    const existing = await this.prisma.customer.findMany({ where: { companyId }, select: { id: true, phone: true, email: true } });
    const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [normalizePhone(c.phone!), c.id]));
    const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]));

    const result: ImportResultDto = { created: 0, updated: 0, errors: [] };
    for (const { line, cells } of sheetRows) {
      try {
        const phone = cellText(cells['Telefone']);
        const email = cellText(cells['E-mail']);
        const existingId = (phone && byPhone.get(normalizePhone(phone))) || (email && byEmail.get(email.toLowerCase())) || undefined;

        const mapped = { name: cellText(cells['Nome']), phone, email, document: cellText(cells['Documento']), notes: cellText(cells['Observações']) };

        if (existingId) {
          const parsed = updateCustomerSchema.safeParse(mapped);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
          await this.customers.update(ctx, existingId, parsed.data);
          result.updated++;
        } else {
          const parsed = customerSchema.safeParse(mapped satisfies Partial<CustomerInput>);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
          await this.customers.create(ctx, parsed.data);
          result.created++;
        }
      } catch (e) {
        result.errors.push({ line, message: e instanceof AppException ? e.message : (e as Error).message });
      }
    }
    return result;
  }
}
