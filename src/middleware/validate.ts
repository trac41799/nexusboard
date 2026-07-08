import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';

/**
 * Zod schemas keyed by the request part they validate. Any provided part is
 * parsed and the coerced result is written back onto the request so downstream
 * handlers receive typed, sanitised input.
 */
export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Builds validation middleware from a set of Zod schemas. On failure the
 * thrown {@link import('zod').ZodError} is forwarded to the central error
 * handler, which returns a `400 VALIDATION_ERROR` with flattened field issues.
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
