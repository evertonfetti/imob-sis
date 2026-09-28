import { z } from 'zod';

/** Importação/exportação em planilha (imóveis, proprietários, clientes). */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024; // planilha, não mídia — 5MB já é uma planilha enorme
export const IMPORT_MAX_ROWS = 5000;

export const importUploadSchema = z.object({
  sizeBytes: z.number().int().positive().max(IMPORT_MAX_BYTES, 'Arquivo muito grande (máximo 5MB).'),
});
export type ImportUploadInput = z.infer<typeof importUploadSchema>;

export const importConfirmSchema = z.object({ key: z.string().trim().min(1) });
export type ImportConfirmInput = z.infer<typeof importConfirmSchema>;

export interface ImportRowError {
  line: number;
  message: string;
}
export interface ImportResultDto {
  created: number;
  updated: number;
  errors: ImportRowError[];
}
