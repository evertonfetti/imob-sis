import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DOCUMENT_MAX_BYTES, type AiDocumentDto, type DocumentConfirmInput, type DocumentUploadInput, type UpdateDocumentInput } from '@imob/types';
import { AuditService } from '../audit/audit.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthedCtx } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
const CHUNK = 900;
const STOP = new Set('para com uma uns umas dos das nos nas que por mais mas como qual quais quando onde sobre isso esse essa este esta seu sua meus minha ter tem ser foi sao vai vou pode posso quero gostaria queria voce voces favor obrigado obrigada ola boa tarde noite dia tudo tambem ainda muito pouco entao porque pois nao sim'.split(' '));

export const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Extrai o texto do arquivo. PDF escaneado (só imagem) devolve vazio. */
export async function extractText(buf: Buffer, contentType: string): Promise<string> {
  if (contentType === 'application/pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n\n') : text;
  }
  if (contentType.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  return buf.toString('utf8');
}

/** Divide em trechos de até ~900 caracteres, respeitando parágrafos e frases. */
export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const pieces = text.split(/\n\s*\n/).flatMap((p) => (p.length <= CHUNK ? [p.trim()] : (p.match(/[^.!?\n]+[.!?]*\s*/g) ?? [p]).map((x) => x.trim())));
  const chunks: string[] = [];
  let cur = '';
  for (const piece of pieces.filter(Boolean)) {
    if (cur && cur.length + piece.length + 1 > CHUNK) { chunks.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${piece}` : piece;
    while (cur.length > CHUNK * 1.6) { chunks.push(cur.slice(0, CHUNK)); cur = cur.slice(CHUNK); } // frase gigante sem pontuação
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Palavras úteis da pergunta, sem acento, com casamento por prefixo (financ:* acha financiamento, financiar…). */
export function toTsQuery(text: string): string | null {
  const words = [...new Set(stripAccents(text.toLowerCase()).match(/[a-z0-9]{4,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 12);
  return words.length ? words.map((w) => `${w}:*`).join(' | ') : null;
}

/** Base de conhecimento do agente: documentos enviados pela imobiliária (ex.: guia de financiamento). */
@Injectable()
export class KnowledgeService {
  private readonly log = new Logger('Knowledge');
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService) {}

  private dto(d: { id: string; title: string; filename: string; mime: string; sizeBytes: number; status: string; error: string | null; charCount: number; active: boolean; createdAt: Date; _count?: { chunks: number } }): AiDocumentDto {
    return { id: d.id, title: d.title, filename: d.filename, mime: d.mime, sizeBytes: d.sizeBytes, status: d.status as AiDocumentDto['status'], error: d.error, charCount: d.charCount, chunks: d._count?.chunks ?? 0, active: d.active, createdAt: d.createdAt.toISOString() };
  }

  async list(companyId: string) {
    const rows = await this.prisma.aiDocument.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { chunks: true } } } });
    return rows.map((r) => this.dto(r));
  }

  createUpload(companyId: string, input: DocumentUploadInput, origin: string) {
    const key = `${companyId}/ai/docs/${randomUUID()}.${EXT[input.contentType]}`;
    return this.storage.createUpload({ key, contentType: input.contentType, maxBytes: input.sizeBytes, origin }).then((t) => ({ key, ...t }));
  }

  async confirm(ctx: AuthedCtx, input: DocumentConfirmInput) {
    const { companyId } = ctx.user;
    if (!input.key.startsWith(`${companyId}/ai/docs/`)) throw new AppException('DOCUMENT_INVALID', 400); // chave de outra empresa ou fora do fluxo
    const head = await this.storage.head(input.key);
    if (!head) throw new AppException('DOCUMENT_INVALID', 400);
    if (head.size > DOCUMENT_MAX_BYTES) { await this.storage.delete(input.key).catch(() => undefined); throw new AppException('DOCUMENT_INVALID', 400); }
    const doc = await this.prisma.aiDocument.create({
      data: { companyId, title: input.title ?? input.filename.replace(/\.[^.]+$/, ''), filename: input.filename, mime: input.contentType, sizeBytes: head.size, storageKey: input.key, createdById: ctx.user.id },
    });
    try {
      const text = await extractText(await this.storage.read(input.key), input.contentType);
      const chunks = chunkText(text);
      if (!chunks.length) throw new AppException('DOCUMENT_EMPTY', 422);
      await this.prisma.$transaction([
        this.prisma.aiDocumentChunk.createMany({ data: chunks.map((content, position) => ({ documentId: doc.id, companyId, position, content })) }),
        this.prisma.aiDocument.update({ where: { id: doc.id }, data: { status: 'READY', charCount: text.length } }),
      ]);
    } catch (e) {
      const empty = e instanceof AppException;
      if (!empty) this.log.warn(`Falha ao ler o documento ${doc.id}: ${(e as Error).message}`);
      await this.prisma.aiDocument.update({ where: { id: doc.id }, data: { status: 'FAILED', error: empty ? 'O documento não tem texto legível (talvez seja uma imagem escaneada).' : 'Não foi possível ler o arquivo. Confira se não está corrompido ou protegido por senha.' } });
    }
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: doc.id, action: 'DOCUMENT_ADD', after: { title: doc.title, filename: input.filename }, ctx });
    return this.get(companyId, doc.id);
  }

  async get(companyId: string, id: string) {
    const d = await this.prisma.aiDocument.findFirst({ where: { id, companyId }, include: { _count: { select: { chunks: true } } } });
    if (!d) throw notFound('Documento não encontrado.');
    return this.dto(d);
  }

  async update(ctx: AuthedCtx, id: string, input: UpdateDocumentInput) {
    await this.get(ctx.user.companyId, id);
    await this.prisma.aiDocument.update({ where: { id }, data: input });
    return this.get(ctx.user.companyId, id);
  }

  async remove(ctx: AuthedCtx, id: string) {
    const { companyId } = ctx.user;
    const d = await this.prisma.aiDocument.findFirst({ where: { id, companyId } });
    if (!d) throw notFound('Documento não encontrado.');
    await this.prisma.aiDocument.delete({ where: { id } }); // os trechos saem em cascata
    await this.storage.delete(d.storageKey).catch(() => undefined);
    await this.audit.record({ companyId, entity: 'INTEGRATION', entityId: id, action: 'DOCUMENT_REMOVE', before: { title: d.title }, ctx });
  }

  /** Trechos mais relevantes para uma pergunta (só de documentos ativos e prontos da empresa). */
  async search(companyId: string, query: string, limit = 4): Promise<{ document: string; excerpt: string; rank: number }[]> {
    const q = toTsQuery(query);
    if (!q) return [];
    const rows = await this.prisma.$queryRaw<{ title: string; content: string; rank: number }[]>`
      SELECT d.title, c.content, ts_rank_cd(c.tsv, query) AS rank
      FROM ai_document_chunks c
      JOIN ai_documents d ON d.id = c."documentId" AND d.active AND d.status = 'READY'
      CROSS JOIN to_tsquery('portuguese', ${q}) query
      WHERE c."companyId" = ${companyId} AND c.tsv @@ query
      ORDER BY rank DESC, c.position ASC
      LIMIT ${limit}`;
    return rows.map((r) => ({ document: r.title, excerpt: r.content, rank: Number(r.rank) }));
  }
}
