# HANDOFF 1.2 — Authentication System

**Agent Ref:** agent-1.2
**Phase:** 1 (Foundation) · **Wave:** 1
**Status:** `[ACC:STATUS from=agent-1.2] COMPLETE`

---

## Completed Work

JWT-based authentication with email/password + OAuth2 (Google/GitHub), fully wired into an Express server.

Files created:

| File | Purpose |
|------|---------|
| `src/auth/types.ts` | Shared interfaces (`JwtPayload`, `TokenPair`, `PublicUser`, `AuthUser`, `OAuthProfile`, `ApiError`) + `Express.User` augmentation so `req.user` is typed. |
| `src/auth/jwt.ts` | `signAccessToken` (15m), `signRefreshToken` (7d), `generateTokenPair`, `verifyAccessToken`, `verifyRefreshToken`, `tokenConfig`. Type-guards access vs refresh tokens. |
| `src/auth/middleware.ts` | `authenticateToken` (required) + `optionalAuth`. Reads `Authorization: Bearer` header or `accessToken` cookie; attaches `req.user`. |
| `src/auth/oauth.ts` | Passport Google + GitHub strategies (`session: false`), `configurePassport()`, `isProviderConfigured()`, `findOrCreateOAuthUser()`. |
| `src/auth/router.ts` | All 9 auth endpoints, zod validation, bcrypt hashing (10 rounds), refresh-token rotation + revocation, structured JSON errors. |
| `src/server.ts` | Express app: CORS (credentials), JSON/urlencoded body parsers, cookie-parser, `passport.initialize()`, `/api/health`, auth router at `/api/auth`, 404 + central error handlers. Exports `app`; only listens when run directly. |
| `src/lib/prisma.ts` | Shared `PrismaClient` singleton (reused across dev reloads). |
| `package.json`, `tsconfig.json`, `.env.example`, `.gitignore` | Project scaffold (project was empty). |

Supporting libs installed: `express`, `cors`, `cookie-parser`, `bcrypt`, `jsonwebtoken`, `passport`, `passport-google-oauth20`, `passport-github2`, `zod`, `@prisma/client`, `dotenv` (+ `@types/*`, `typescript`, `prisma`, `ts-node-dev`).

---

## Test Results

`npx tsc --noEmit` — **PASS** (0 errors).

Runtime smoke test (temporary, run then removed) — **ALL PASSED**:
- JWT sign/verify round-trip + access/refresh type guarding
- Tampered/invalid token rejected
- `GET /api/health` → `200 {status:"ok",...}`
- Unknown route → `404 {error:{code:"NOT_FOUND"}}`
- `GET /api/auth/me` without token → `401 {error:{code:"AUTH_TOKEN_MISSING"}}`

> DB-backed endpoints (register/login/refresh/me happy paths, OAuth callbacks) were **not** run end-to-end because there is no live Postgres or generated Prisma client yet (schema owned by agent-1.1). They typecheck against the assumed model shape below. Run `npx prisma generate` + point `DATABASE_URL` at a DB, then exercise them.

---

## API Contracts

Base path: `/api/auth`. All errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.

On success, `register`/`login`/`refresh`/OAuth also set httpOnly cookies `accessToken` (15m) and `refreshToken` (7d).

| Method | Path | Request body | Success response |
|--------|------|--------------|------------------|
| POST | `/register` | `{ email, password(≥8), name }` | `201 { user: PublicUser, accessToken, refreshToken }` |
| POST | `/login` | `{ email, password }` | `200 { user: PublicUser, accessToken, refreshToken }` |
| POST | `/logout` | `{ refreshToken? }` or cookie | `200 { success: true }` (clears cookies, revokes token) |
| POST | `/refresh` | `{ refreshToken? }` or cookie | `200 { accessToken, refreshToken }` (rotates token) |
| GET | `/me` | `Authorization: Bearer <access>` | `200 { user: PublicUser }` |
| GET | `/oauth/google` | — | `302` → Google consent |
| GET | `/oauth/google/callback` | — | `302` → `OAUTH_SUCCESS_REDIRECT?accessToken=&refreshToken=` |
| GET | `/oauth/github` | — | `302` → GitHub consent |
| GET | `/oauth/github/callback` | — | `302` → `OAUTH_SUCCESS_REDIRECT?accessToken=&refreshToken=` |

`PublicUser` = `{ id, email, name, avatarUrl, oauthProvider, createdAt, updatedAt }` (never includes `passwordHash`).

Error codes: `VALIDATION_ERROR`(400), `INVALID_CREDENTIALS`(401), `EMAIL_IN_USE`(409), `AUTH_TOKEN_MISSING/EXPIRED/INVALID`(401), `REFRESH_TOKEN_MISSING/EXPIRED/INVALID/REVOKED`(401), `USER_NOT_FOUND`(404), `OAUTH_NOT_CONFIGURED`(503), `OAUTH_FAILED`(401), `INTERNAL_ERROR`(500), `NOT_FOUND`(404).

Also on `src/server.ts`: `GET /api/health` → `200 { status, uptime, timestamp }`.

---

## Environment Variables Required

See `.env.example`. Required for full function:

| Var | Purpose |
|-----|---------|
| `JWT_SECRET` | **Required** — signs access tokens (and refresh if `JWT_REFRESH_SECRET` unset). |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (falls back to `JWT_SECRET`). Recommended distinct value. |
| `DATABASE_URL` | Postgres connection for Prisma. |
| `CLIENT_URL` | CORS origin + default SPA base (default `http://localhost:5173`). |
| `APP_BASE_URL` | Public API base for OAuth callback URLs (default `http://localhost:3000`). |
| `OAUTH_SUCCESS_REDIRECT` | Where OAuth callbacks redirect with tokens (default `${CLIENT_URL}/oauth/callback`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (endpoints return 503 if unset). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (endpoints return 503 if unset). |
| `PORT` | Server port (default 3000). |

---

## Design Decisions

1. **⚠️ Prisma model shape assumption (top coordination item with agent-1.1).** The code assumes idiomatic **camelCase** `User` fields: `id, email, name, avatarUrl, passwordHash, oauthProvider, oauthId, createdAt, updatedAt`. If agent-1.1's `schema.prisma` uses snake_case model fields (e.g. `password_hash`) rather than `@map`-ed columns, adjust property access in `src/auth/router.ts`, `src/auth/oauth.ts`, and `toPublicUser`.
2. **⚠️ `AuthToken` model assumption.** Refresh tokens are persisted/revoked/validated via `prisma.authToken` with shape `{ id, userId, token(@unique), type, expiresAt, createdAt }`. If agent-1.1 defines different fields, update the three helpers in `router.ts` (`persistRefreshToken`, `revokeRefreshToken`, `isRefreshTokenActive`). These helpers **fail soft** (log a warning, fall back to stateless JWT validation) so auth works before the table exists — but revocation only takes effect once the table matches.
3. **Refresh token rotation.** `/refresh` revokes the presented token and issues a new pair, limiting replay.
4. **Stateless-friendly, cookie + bearer.** Tokens are returned in JSON *and* set as httpOnly cookies. `authenticateToken` accepts either, so both SPA (bearer) and cookie flows work.
5. **Passport without sessions.** OAuth uses `session: false`; passport only performs the redirect handshake, then we mint our own JWTs — no session store needed.
6. **OAuth account linking.** `findOrCreateOAuthUser` matches by `(provider, oauthId)`, else links to an existing same-email account, else creates a new user.
7. **No self-typecheck coupling to agent-1.1.** To verify types I generated a Prisma client from a throwaway schema kept under `.acc/` (now deleted) that encoded the assumptions above. The generated client currently in `node_modules/@prisma/client` reflects those assumptions and **must be regenerated** against the real schema.

---

## Handoff Instructions (for Wave 2 API layer)

1. **Regenerate Prisma client** after agent-1.1's schema merges: `npm install && npx prisma generate`. Then fix any field-name mismatches flagged in Design Decisions #1/#2 (search `avatarUrl`, `passwordHash`, `oauthProvider`, `oauthId`, `authToken`).
2. **Reuse the Prisma singleton** from `src/lib/prisma.ts` in all Wave 2 routers — do not instantiate new `PrismaClient`s.
3. **Protect routes** with `import { authenticateToken } from './auth/middleware'`; read the user via `req.user!.id` / `req.user!.email` (typed as `AuthUser`).
4. **Server integration point:** `src/server.ts` already mounts `/api/auth` and has CORS/JSON/cookie/passport middleware + a central error handler. Wave 2.1 should mount `/api/workspaces`, `/api/tasks`, `/api/comments` on the same `app` (before the 404 handler) and can replace the inline `/api/health` with its DB-aware version.
5. **Socket auth (2.2):** reuse `verifyAccessToken` from `src/auth/jwt.ts` to validate the handshake token; it returns `{ sub, email }`.
6. **Env:** copy `.env.example` → `.env` and set at least `JWT_SECRET` and `DATABASE_URL` before running `npm run dev`.
