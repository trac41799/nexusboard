import jwt, { SignOptions } from 'jsonwebtoken';
import { JwtPayload, TokenPair } from './types';

const ACCESS_TOKEN_TTL: SignOptions['expiresIn'] = '15m';
const REFRESH_TOKEN_TTL: SignOptions['expiresIn'] = '7d';

function getAccessSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

function getRefreshSecret(): string {
  // Fall back to JWT_SECRET only if a dedicated refresh secret is not provided.
  const secret = process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET (or JWT_SECRET) environment variable is not set');
  }
  return secret;
}

/** Sign a short-lived (15m) access token. */
export function signAccessToken(user: { id: string; email: string }): string {
  const payload: JwtPayload = { sub: user.id, email: user.email, type: 'access' };
  return jwt.sign(payload, getAccessSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

/** Sign a long-lived (7d) refresh token. */
export function signRefreshToken(user: { id: string; email: string }): string {
  const payload: JwtPayload = { sub: user.id, email: user.email, type: 'refresh' };
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: REFRESH_TOKEN_TTL });
}

/** Convenience helper that mints both tokens at once. */
export function generateTokenPair(user: { id: string; email: string }): TokenPair {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

/** Verify and decode an access token. Throws on invalid/expired tokens. */
export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getAccessSecret()) as JwtPayload;
  if (decoded.type !== 'access') {
    throw new jwt.JsonWebTokenError('Expected an access token');
  }
  return decoded;
}

/** Verify and decode a refresh token. Throws on invalid/expired tokens. */
export function verifyRefreshToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getRefreshSecret()) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Expected a refresh token');
  }
  return decoded;
}

export const tokenConfig = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  /** Refresh cookie lifetime in milliseconds (7 days). */
  REFRESH_COOKIE_MAX_AGE: 7 * 24 * 60 * 60 * 1000,
} as const;
