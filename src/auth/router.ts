import { Router, Request, Response, CookieOptions } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticateToken } from './middleware';
import {
  generateTokenPair,
  signAccessToken,
  signRefreshToken,
  tokenConfig,
  verifyRefreshToken,
} from './jwt';
import { configurePassport, isProviderConfigured, passport } from './oauth';
import { ApiError, JwtPayload, PublicUser } from './types';

const BCRYPT_ROUNDS = 10;
const REFRESH_COOKIE = 'refreshToken';
const ACCESS_COOKIE = 'accessToken';

const router = Router();

// Register passport strategies once when the router is constructed.
configurePassport();

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  res.status(status).json(body);
}

function toPublicUser(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  oauthProvider: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    oauthProvider: user.oauthProvider,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function cookieOptions(maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  };
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(tokenConfig.REFRESH_COOKIE_MAX_AGE));
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

/**
 * Persists a refresh token so it can later be revoked (logout) or validated
 * (refresh). Uses the `AuthToken` model owned by agent-1.1. Assumed shape:
 *   { id, userId, token, type, expiresAt, createdAt }
 * Failures are swallowed so that auth still works before the table exists;
 * see HANDOFF_1.2.md ("Design Decisions") for the coordination note.
 */
async function persistRefreshToken(userId: string, token: string): Promise<void> {
  try {
    await prisma.authToken.create({
      data: {
        userId,
        token,
        type: 'refresh',
        expiresAt: new Date(Date.now() + tokenConfig.REFRESH_COOKIE_MAX_AGE),
      },
    });
  } catch (err) {
    console.warn('[auth] could not persist refresh token (AuthToken table unavailable):', (err as Error).message);
  }
}

async function revokeRefreshToken(token: string): Promise<void> {
  try {
    await prisma.authToken.deleteMany({ where: { token } });
  } catch (err) {
    console.warn('[auth] could not revoke refresh token:', (err as Error).message);
  }
}

/** Returns true if the token is present in the store (or the store is unavailable). */
async function isRefreshTokenActive(token: string): Promise<boolean> {
  try {
    const record = await prisma.authToken.findFirst({ where: { token, type: 'refresh' } });
    return Boolean(record);
  } catch (err) {
    console.warn('[auth] refresh-token store unavailable, accepting valid JWT:', (err as Error).message);
    return true;
  }
}

function readRefreshToken(req: Request): string | undefined {
  const fromCookie = typeof req.cookies?.[REFRESH_COOKIE] === 'string' ? req.cookies[REFRESH_COOKIE] : undefined;
  const fromBody = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
  return fromCookie ?? fromBody;
}

/* ------------------------------------------------------------------ *
 * POST /api/auth/register
 * ------------------------------------------------------------------ */

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid registration payload', parsed.error.flatten());
  }
  const { email, password, name } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return sendError(res, 409, 'EMAIL_IN_USE', 'An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
    });

    const tokens = generateTokenPair({ id: user.id, email: user.email });
    await persistRefreshToken(user.id, tokens.refreshToken);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.status(201).json({ user: toPublicUser(user), ...tokens });
  } catch (err) {
    console.error('[auth] register failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to register user');
  }
});

/* ------------------------------------------------------------------ *
 * POST /api/auth/login
 * ------------------------------------------------------------------ */

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid login payload', parsed.error.flatten());
  }
  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      // Either no such user or an OAuth-only account with no password set.
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const tokens = generateTokenPair({ id: user.id, email: user.email });
    await persistRefreshToken(user.id, tokens.refreshToken);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.status(200).json({ user: toPublicUser(user), ...tokens });
  } catch (err) {
    console.error('[auth] login failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to log in');
  }
});

/* ------------------------------------------------------------------ *
 * POST /api/auth/logout
 * ------------------------------------------------------------------ */

router.post('/logout', async (req: Request, res: Response) => {
  const token = readRefreshToken(req);
  if (token) {
    await revokeRefreshToken(token);
  }
  clearAuthCookies(res);
  return res.status(200).json({ success: true });
});

/* ------------------------------------------------------------------ *
 * POST /api/auth/refresh
 * ------------------------------------------------------------------ */

router.post('/refresh', async (req: Request, res: Response) => {
  const token = readRefreshToken(req);
  if (!token) {
    return sendError(res, 401, 'REFRESH_TOKEN_MISSING', 'Refresh token was not provided');
  }

  let payload: JwtPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return sendError(res, 401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
    }
    return sendError(res, 401, 'REFRESH_TOKEN_INVALID', 'Refresh token is invalid');
  }

  const active = await isRefreshTokenActive(token);
  if (!active) {
    return sendError(res, 401, 'REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked');
  }

  // Rotate: revoke the used token and mint a fresh pair.
  await revokeRefreshToken(token);
  const identity = { id: payload.sub, email: payload.email };
  const accessToken = signAccessToken(identity);
  const refreshToken = signRefreshToken(identity);
  await persistRefreshToken(identity.id, refreshToken);
  setAuthCookies(res, accessToken, refreshToken);

  return res.status(200).json({ accessToken, refreshToken });
});

/* ------------------------------------------------------------------ *
 * GET /api/auth/me
 * ------------------------------------------------------------------ */

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'Authenticated user no longer exists');
    }
    return res.status(200).json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('[auth] /me failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load profile');
  }
});

/* ------------------------------------------------------------------ *
 * OAuth — Google
 * ------------------------------------------------------------------ */

function issueTokensAndRedirect(req: Request, res: Response): void {
  const user = req.user as { id: string; email: string } | undefined;
  if (!user) {
    return void sendError(res, 401, 'OAUTH_FAILED', 'OAuth authentication failed');
  }
  const tokens = generateTokenPair(user);
  void persistRefreshToken(user.id, tokens.refreshToken);
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

  const redirectBase = process.env.OAUTH_SUCCESS_REDIRECT ?? `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/oauth/callback`;
  const url = new URL(redirectBase);
  url.searchParams.set('accessToken', tokens.accessToken);
  url.searchParams.set('refreshToken', tokens.refreshToken);
  res.redirect(url.toString());
}

router.get('/oauth/google', (req, res, next) => {
  if (!isProviderConfigured('google')) {
    return sendError(res, 503, 'OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured');
  }
  return passport.authenticate('google', { session: false, scope: ['profile', 'email'] })(req, res, next);
});

router.get(
  '/oauth/google/callback',
  (req, res, next) => {
    if (!isProviderConfigured('google')) {
      return sendError(res, 503, 'OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured');
    }
    return passport.authenticate('google', { session: false, failureRedirect: '/api/auth/oauth/failure' })(
      req,
      res,
      next,
    );
  },
  issueTokensAndRedirect,
);

/* ------------------------------------------------------------------ *
 * OAuth — GitHub
 * ------------------------------------------------------------------ */

router.get('/oauth/github', (req, res, next) => {
  if (!isProviderConfigured('github')) {
    return sendError(res, 503, 'OAUTH_NOT_CONFIGURED', 'GitHub OAuth is not configured');
  }
  return passport.authenticate('github', { session: false, scope: ['user:email'] })(req, res, next);
});

router.get(
  '/oauth/github/callback',
  (req, res, next) => {
    if (!isProviderConfigured('github')) {
      return sendError(res, 503, 'OAUTH_NOT_CONFIGURED', 'GitHub OAuth is not configured');
    }
    return passport.authenticate('github', { session: false, failureRedirect: '/api/auth/oauth/failure' })(
      req,
      res,
      next,
    );
  },
  issueTokensAndRedirect,
);

router.get('/oauth/failure', (_req, res) => {
  return sendError(res, 401, 'OAUTH_FAILED', 'OAuth authentication failed');
});

export default router;
