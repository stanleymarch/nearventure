import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter — catches all exceptions (HttpException and
 * unknown errors) and returns a consistent JSON shape.
 *
 * On HttpException: preserve the status code and message (safe to expose).
 * On unknown error: log the full stack, return HTTP 500 with a sanitised
 * message so internals never leak to the client.
 *
 * Response shape:
 *   { error: { code: number, message: string, details?: any } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, any>;
        message = obj.message
          ? Array.isArray(obj.message)
            ? obj.message.join('; ')
            : String(obj.message)
          : exception.message;
        details = obj.error || obj.details;
      } else {
        message = exception.message;
      }
    } else {
      // Unknown error: log full stack, sanitise for client.
      const err = exception as Error;
      this.logger.error(
        `Unhandled exception: ${err?.message || String(exception)}`,
        err?.stack,
      );
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Внутренняя ошибка сервера. Попробуйте позже.';
      details = undefined;
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status >= 400) {
      this.logger.warn(`${request.method} ${request.url} → ${status}: ${message}`);
    }

    response.status(status).json({
      error: {
        code: status,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    });
  }
}
