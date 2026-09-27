import { HttpException } from '@nestjs/common';
import { ERROR_CODES, ErrorCode } from '@imob/types';

/** Erro de negócio com código estável e mensagem em português. */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    status: number,
    message?: string,
    public readonly details?: unknown,
  ) {
    super({ code, message: message ?? ERROR_CODES[code], details }, status);
  }
}

export const notFound = (message?: string) => new AppException('NOT_FOUND', 404, message);
