import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  createPropertySchema, IMPORT_MAX_ROWS, PROPERTY_STATUSES, PROPERTY_PURPOSES, PURPOSE_LABELS, STATUS_LABELS, updatePropertySchema,
  type CreatePropertyInput, type ImportConfirmInput, type ImportResultDto, type PropertyPurpose, type PropertyStatus, type UpdatePropertyInput,
} from '@imob/types';
import { AppException } from '../common/app-exception';
import { parseMoney } from '../common/util';
import type { AuthedCtx } from '../common/request-context';
import { buildXlsx, cellBool, cellFloat, cellInt, cellText, readXlsxRows } from '../common/xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PropertiesService } from './properties.service';

const HEADERS = [
  'Código', 'Título', 'Tipo', 'Subtipo', 'Finalidade', 'Situação',
  'Valor de venda', 'Valor de locação', 'Condomínio', 'IPTU', 'Valor mínimo de negociação',
  'Dormitórios', 'Suítes', 'Banheiros', 'Vagas',
  'Área total (m²)', 'Área útil (m²)', 'Área construída (m²)', 'Área do terreno (m²)',
  'CEP', 'Endereço', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Mostrar endereço exato',
  'Proprietário (nome ou documento)', 'Corretor responsável (e-mail)', 'Filial', 'Destaque', 'Resumo', 'Descrição',
] as const;

const onlyDigits = (s: string) => s.replace(/\D/g, '');
const norm = (s: string) => s.trim().toLowerCase();
const purposeFromLabel = (s: string): PropertyPurpose | null => PROPERTY_PURPOSES.find((p) => norm(PURPOSE_LABELS[p]) === norm(s)) ?? null;
const statusFromLabel = (s: string): PropertyStatus | null => PROPERTY_STATUSES.filter((x) => x !== 'ARCHIVED').find((st) => norm(STATUS_LABELS[st]) === norm(s)) ?? null;

@Injectable()
export class PropertiesImportExportService {
  constructor(
    private readonly props: PropertiesService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async export(companyId: string): Promise<Buffer> {
    const rows = await this.prisma.property.findMany({
      where: { companyId }, orderBy: { code: 'asc' },
      include: { type: { select: { name: true } }, owner: { select: { name: true, document: true } }, broker: { select: { email: true } }, branch: { select: { name: true } } },
    });
    const num = (v: unknown) => (v == null ? '' : Number(v));
    return buildXlsx('Imóveis', HEADERS.map((h) => ({ header: h, key: h, width: 26 })), rows.map((p) => ({
      'Código': p.code, 'Título': p.title, 'Tipo': p.type.name, 'Subtipo': p.subtype ?? '',
      'Finalidade': PURPOSE_LABELS[p.purpose as PropertyPurpose], 'Situação': STATUS_LABELS[p.status as PropertyStatus],
      'Valor de venda': num(p.salePrice), 'Valor de locação': num(p.rentPrice), 'Condomínio': num(p.condominiumFee), 'IPTU': num(p.propertyTax),
      'Valor mínimo de negociação': num(p.minimumNegotiationPrice),
      'Dormitórios': p.bedrooms ?? '', 'Suítes': p.suites ?? '', 'Banheiros': p.bathrooms ?? '', 'Vagas': p.parkingSpaces ?? '',
      'Área total (m²)': num(p.totalArea), 'Área útil (m²)': num(p.usefulArea), 'Área construída (m²)': num(p.builtArea), 'Área do terreno (m²)': num(p.landArea),
      'CEP': p.zipCode ?? '', 'Endereço': p.address ?? '', 'Número': p.number ?? '', 'Complemento': p.complement ?? '',
      'Bairro': p.neighborhood ?? '', 'Cidade': p.city ?? '', 'UF': p.state ?? '', 'Mostrar endereço exato': p.showExactAddress ? 'Sim' : 'Não',
      'Proprietário (nome ou documento)': p.owner ? (p.owner.document || p.owner.name) : '', 'Corretor responsável (e-mail)': p.broker?.email ?? '',
      'Filial': p.branch?.name ?? '', 'Destaque': p.featured ? 'Sim' : 'Não', 'Resumo': p.shortDescription ?? '', 'Descrição': p.description ?? '',
    })));
  }

  template(): Promise<Buffer> {
    return buildXlsx('Imóveis', HEADERS.map((h) => ({ header: h, key: h, width: 26 })), []);
  }

  createUpload(companyId: string, input: { sizeBytes: number }, origin: string) {
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

    // ---------- Referências (tipo, proprietário, corretor, filial): carregadas uma vez, não por linha ----------
    const [types, owners, brokers, branches, byCode] = await Promise.all([
      this.prisma.propertyType.findMany({ where: { companyId }, select: { id: true, name: true } }),
      this.prisma.owner.findMany({ where: { companyId }, select: { id: true, name: true, document: true } }),
      this.prisma.user.findMany({ where: { companyId, status: 'ACTIVE' }, select: { id: true, email: true } }),
      this.prisma.branch.findMany({ where: { companyId }, select: { id: true, name: true } }),
      this.prisma.property.findMany({ where: { companyId }, select: { id: true, code: true } }),
    ]);
    const typeByName = new Map(types.map((t) => [norm(t.name), t.id]));
    const ownerByDocument = new Map(owners.filter((o) => o.document).map((o) => [onlyDigits(o.document!), o.id]));
    const ownerByName = new Map(owners.map((o) => [norm(o.name), o.id]));
    const brokerByEmail = new Map(brokers.map((u) => [norm(u.email), u.id]));
    const branchByName = new Map(branches.map((b) => [norm(b.name), b.id]));
    const propertyByCode = new Map(byCode.map((p) => [norm(p.code), p.id]));

    /** Cria o tipo sozinho se ainda não existir — reduz o trabalho de preparar o catálogo antes de migrar. */
    const resolveType = async (name: string): Promise<string> => {
      const key = norm(name);
      const existing = typeByName.get(key);
      if (existing) return existing;
      const created = await this.prisma.propertyType.create({ data: { companyId, name } });
      typeByName.set(key, created.id);
      return created.id;
    };

    const result: ImportResultDto = { created: 0, updated: 0, errors: [] };
    for (const { line, cells } of sheetRows) {
      try {
        const purposeLabel = cellText(cells['Finalidade']);
        const purpose = purposeLabel ? purposeFromLabel(purposeLabel) : null;
        if (purposeLabel && !purpose) throw new Error(`Finalidade "${purposeLabel}" não reconhecida (use Venda, Aluguel ou Venda e aluguel).`);

        const statusLabel = cellText(cells['Situação']);
        const status = statusLabel ? statusFromLabel(statusLabel) : null;
        if (statusLabel && !status) throw new Error(`Situação "${statusLabel}" não reconhecida.`);

        const typeName = cellText(cells['Tipo']);
        const typeId = typeName ? await resolveType(typeName) : undefined;

        const ownerRef = cellText(cells['Proprietário (nome ou documento)']);
        let ownerId: string | undefined;
        if (ownerRef) {
          ownerId = ownerByDocument.get(onlyDigits(ownerRef)) ?? ownerByName.get(norm(ownerRef));
          if (!ownerId) throw new Error(`Proprietário "${ownerRef}" não encontrado. Importe os proprietários antes, ou deixe em branco.`);
        }

        const brokerRef = cellText(cells['Corretor responsável (e-mail)']);
        let brokerId: string | undefined;
        if (brokerRef) {
          brokerId = brokerByEmail.get(norm(brokerRef));
          if (!brokerId) throw new Error(`Corretor com e-mail "${brokerRef}" não encontrado (precisa ser um usuário ativo).`);
        }

        const branchName = cellText(cells['Filial']);
        let branchId: string | undefined;
        if (branchName) {
          branchId = branchByName.get(norm(branchName));
          if (!branchId) throw new Error(`Filial "${branchName}" não encontrada.`);
        }

        const salePrice = cellText(cells['Valor de venda']) ? parseMoney(cells['Valor de venda']) : undefined;
        const rentPrice = cellText(cells['Valor de locação']) ? parseMoney(cells['Valor de locação']) : undefined;
        const condominiumFee = cellText(cells['Condomínio']) ? parseMoney(cells['Condomínio']) : undefined;
        const propertyTax = cellText(cells['IPTU']) ? parseMoney(cells['IPTU']) : undefined;
        const minimumNegotiationPrice = cellText(cells['Valor mínimo de negociação']) ? parseMoney(cells['Valor mínimo de negociação']) : undefined;

        const mapped: Record<string, unknown> = {
          title: cellText(cells['Título']), typeId, subtype: cellText(cells['Subtipo']), purpose: purpose ?? undefined, status: status ?? undefined,
          salePrice, rentPrice, condominiumFee, propertyTax, minimumNegotiationPrice,
          bedrooms: cellInt(cells['Dormitórios']), suites: cellInt(cells['Suítes']), bathrooms: cellInt(cells['Banheiros']), parkingSpaces: cellInt(cells['Vagas']),
          totalArea: cellFloat(cells['Área total (m²)']), usefulArea: cellFloat(cells['Área útil (m²)']),
          builtArea: cellFloat(cells['Área construída (m²)']), landArea: cellFloat(cells['Área do terreno (m²)']),
          zipCode: cellText(cells['CEP']), address: cellText(cells['Endereço']), number: cellText(cells['Número']), complement: cellText(cells['Complemento']),
          neighborhood: cellText(cells['Bairro']), city: cellText(cells['Cidade']), state: cellText(cells['UF']),
          showExactAddress: cellBool(cells['Mostrar endereço exato']), ownerId, brokerId, branchId,
          featured: cellBool(cells['Destaque']), shortDescription: cellText(cells['Resumo']), description: cellText(cells['Descrição']),
        };
        // Campos com null explícito (número inválido) viram erro, em vez de serem silenciosamente ignorados.
        for (const [k, v] of Object.entries(mapped)) if (v === null) throw new Error(`Valor inválido em "${k}".`);

        const code = cellText(cells['Código']);
        const existingId = code ? propertyByCode.get(norm(code)) : undefined;

        if (existingId) {
          const parsed = updatePropertySchema.safeParse(mapped satisfies Partial<UpdatePropertyInput>);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
          await this.props.update(ctx, existingId, parsed.data);
          result.updated++;
        } else {
          if (!purpose) throw new Error('Informe a finalidade (Venda, Aluguel ou Venda e aluguel).');
          if (!typeId) throw new Error('Informe o tipo do imóvel.');
          const parsed = createPropertySchema.safeParse({ ...mapped, purpose, typeId } satisfies Partial<CreatePropertyInput>);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
          const createdProp = await this.props.create(ctx, parsed.data);
          propertyByCode.set(norm((createdProp as { code: string }).code), (createdProp as { id: string }).id);
          result.created++;
        }
      } catch (e) {
        result.errors.push({ line, message: e instanceof AppException ? e.message : (e as Error).message });
      }
    }
    return result;
  }
}
