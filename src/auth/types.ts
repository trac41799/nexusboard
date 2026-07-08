/**
 * Shared authentication types and interfaces for NexusBoard.
 *
 * NOTE ON PRISMA FIELD NAMING (coordination point with agent-1.1):
 * This module assumes the generated Prisma `User` model exposes idiomatic
 * camelCase fields (id, email, name, avatarUrl, passwordHash, oauthProvider,
 * oauthId, createdAt, updatedAt). If agent-1.1 maps columns differently, only
 * the property access in `oauth.ts` / `router.ts` needs adjusting.
 */

/** Token type discriminator used when signing/verifying JWTs. */
export type TokenType = 'access' | 'refresh';

/** Payload embedded in a signed JWT. */
export interface JwtPayload {
  /** User id (subject). */
  sub: string;
  email: string;
  type: TokenType;
}

/** Pair of tokens returned to the client on auth success. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Safe, serialisable representation of a user (never contains the password hash). */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  oauthProvider: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Authenticated principal attached to `req.user` by `authenticateToken`. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Normalised OAuth profile produced by the passport strategies. */
export interface OAuthProfile {
  provider: 'google' | 'github';
  oauthId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Structured JSON error body returned for every failure case. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Optional field-level validation issues. */
    details?: unknown;
  };
}

// Augment Express' `User` (declared by @types/passport, which also declares
// `Request.user?: User`) so `req.user` is strongly typed everywhere without
// conflicting with passport's own declaration.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends AuthUser {}
  }
}
