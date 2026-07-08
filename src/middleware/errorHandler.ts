import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../auth/types';

/**
 * Application-level error carrying an HTTP status, a stable machine-readable
 * `code`, a human message, and optional `details`. Throw these from route
 * handlers (directly or via the static helpers) and let {@link errorHandler}
 * serialise them into the structured `{ error: { code, message } }` body.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required'): HttpError {
    return new HttpError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): HttpError {
    return new HttpError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): HttpError {
    return new HttpError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, 'CONFLICT', message, details);
  }
}

/**
 * Wraps an async route handler so rejected promises are forwarded to Express'
 * error pipeline instead of crashing the process.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Terminal 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiError = {
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  };
  res.status(404).json(body);
}

function send(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiError = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  res.status(status).json(body);
}

/**
 * Central Express error handler. Converts known error shapes (Zod validation,
 * {@link HttpError}, Prisma request errors) into structured JSON responses and
 * falls back to a 500 for anything unexpected.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ZodError) {
    return send(res, 400, 'VALIDATION_ERROR', 'Request validation failed', err.flatten());
  }

  if (err instanceof HttpError) {
    return send(res, err.statusCode, err.code, err.message, err.details);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2025':
        return send(res, 404, 'NOT_FOUND', 'The requested record was not found');
      case 'P2002':
        return send(res, 409, 'CONFLICT', 'A record with these values already exists', {
          target: err.meta?.target,
        });
      case 'P2003':
        return send(res, 400, 'FOREIGN_KEY_VIOLATION', 'Referenced record does not exist');
      default:
        return send(res, 400, 'DATABASE_ERROR', 'Database request could not be completed');
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return send(res, 400, 'DATABASE_ERROR', 'Invalid database query');
  }

  console.error('[server] unhandled error:', err);
  return send(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
