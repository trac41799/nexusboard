import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from './jwt';
import { ApiError } from './types';

function unauthorized(res: Response, code: string, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(401).json(body);
}

/**
 * Extracts a bearer token from the `Authorization` header (falling back to an
 * `accessToken` cookie), verifies it, and attaches the principal to `req.user`.
 * Responds with a structured 401 error on any failure.
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header && header.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length).trim();
  } else if (typeof req.cookies?.accessToken === 'string') {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return unauthorized(res, 'AUTH_TOKEN_MISSING', 'Authentication token was not provided');
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return unauthorized(res, 'AUTH_TOKEN_EXPIRED', 'Authentication token has expired');
    }
    return unauthorized(res, 'AUTH_TOKEN_INVALID', 'Authentication token is invalid');
  }
}

/**
 * Optional-auth variant: attaches `req.user` when a valid token is present but
 * never blocks the request. Useful for endpoints with mixed public/private
 * behaviour.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  let token: string | undefined;

  if (header && header.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length).trim();
  } else if (typeof req.cookies?.accessToken === 'string') {
    token = req.cookies.accessToken;
  }

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email };
    } catch {
      // Ignore invalid tokens in optional mode.
    }
  }
  next();
}
