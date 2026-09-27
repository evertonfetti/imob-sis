import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ERROR_CODES, ApiErrorBody } from '@imob/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from './app-exception';

const STATUS_CODES: Record<number, keyof typeof ERROR_CODES> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_TOKEN_INVALID',
  403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message: string = ERROR_CODES.INTERNAL_ERROR;
    let details: unknown;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      const body = exception.getResponse() as { message: string; details?: unknown };
      message = body.message;
      details = body.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const known = STATUS_CODES[status];
      code = known ?? 'HTTP_ERROR';
      message = known ? ERROR_CODES[known] : exception.message;
    }

    const body: ApiErrorBody = { statusCode: status, code, message, requestId: String(req.id), details };

    if (status >= 500) {
      req.log.error({ requestId: req.id, staffId: req.staff?.id, endpoint: `${req.method} ${req.url}`, err: exception }, 'Erro não tratado');
    } else {
      req.log.warn({ code, status, endpoint: `${req.method} ${req.url}` }, message);
    }

    reply.status(status).send(body);
  }
}
