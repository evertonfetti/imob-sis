import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  IMPORT_MAX_ROWS, OWNER_TYPES, OWNER_TYPE_LABELS, ownerSchema, updateOwnerSchema,
  type ImportConfirmInput, type ImportResultDto, type ImportUploadInput, type OwnerInput,
} from '@imob/types';
import { AppException } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { buildXlsx, cellText, readXlsxRows } from '../common/xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OwnersService } from './owners.service';

const HEADERS = ['Tipo', 'Nome', 'Documento', 'E-mail', 'Telefone', 'WhatsApp', 'Endereço', 'Cidade', 'UF', 'Observações'] as const;
const onlyDigits = (s: string) => s.replace(/\D/g, '');
const typeFromLabel = (s: string): 'PERSON' | 'COMPANY' | null => {
  const found = OWNER_TYPES.find((t) => OWNER_TYPE_LABELS[t].toLowerCase() === s.trim().toLowerCase());
  return found ?? null;
};

@Injectable()
export class OwnersImportExportService {
  constructor(
    private readonly owners: OwnersService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async export(companyId: string): Promise<Buffer> {
    const rows = await this.prisma.owner.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    return buildXlsx(
      'Proprietários',
      HEADERS.map((h) => ({ header: h, key: h })),
      rows.map((o) => ({
        Tipo: OWNER_TYPE_LABELS[o.type], Nome: o.name, Documento: o.document ?? '', 'E-mail': o.email ?? '',
        Telefone: o.phone ?? '', WhatsApp: o.whatsapp ?? '', Endereço: o.address ?? '', Cidade: o.city ?? '',
        UF: o.state ?? '', Observações: o.notes ?? '',
      })),
    );
  }

  /** Planilha vazia, só com o cabeçalho — o "Baixar modelo" do painel. */
  template(): Promise<Buffer> {
    return buildXlsx('Proprietários', HEADERS.map((h) => ({ header: h, key: h })), []);
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
    const head = await this.storage.head(input.key);
    if (!head) throw new AppException('IMPORT_FILE_INVALID', 400);
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

    // Um proprietário já existente é reconhecido pelo documento (CPF/CNPJ), comparado só pelos dígitos —
    // buscar todos de uma vez evita uma consulta por linha da planilha.
    const byDocument = new Map<string, string>();
    for (const o of await this.prisma.owner.findMany({ where: { companyId, document: { not: null } }, select: { id: true, document: true } })) {
      const digits = onlyDigits(o.document ?? '');
      if (digits) byDocument.set(digits, o.id);
    }

    const result: ImportResultDto = { created: 0, updated: 0, errors: [] };
    for (const { line, cells } of sheetRows) {
      try {
        const rawType = cellText(cells['Tipo']);
        const type = rawType ? typeFromLabel(rawType) : null;
        if (rawType && !type) throw new Error(`Tipo "${rawType}" não reconhecido (use "Pessoa física" ou "Empresa").`);

        const document = cellText(cells['Documento']);
        const existingId = document ? byDocument.get(onlyDigits(document)) : undefined;

        const mapped = {
          type: type ?? undefined, name: cellText(cells['Nome']), document, email: cellText(cells['E-mail']),
          phone: cellText(cells['Telefone']), whatsapp: cellText(cells['WhatsApp']), address: cellText(cells['Endereço']),
          city: cellText(cells['Cidade']), state: cellText(cells['UF']), notes: cellText(cells['Observações']),
        };

        if (existingId) {
          const parsed = updateOwnerSchema.safeParse(mapped);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
          await this.owners.update(ctx, existingId, parsed.data);
          result.updated++;
        } else {
          const parsed = ownerSchema.safeParse({ ...mapped, type: mapped.type ?? 'PERSON' } satisfies Partial<OwnerInput>);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
          await this.owners.create(ctx, parsed.data);
          result.created++;
        }
      } catch (e) {
        result.errors.push({ line, message: e instanceof AppException ? e.message : (e as Error).message });
      }
    }
    return result;
  }
}
