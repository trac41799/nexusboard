# HANDOFF 2.1 — Core REST API (Workspaces / Tasks / Comments)

**Agent Ref:** agent-2.1
**Phase:** 2 · **Wave:** 2 · **Step:** 2.1
**Depends:** Wave 1 (1.1 DB schema, 1.2 Auth)
**Status:** `[ACC:STATUS from=agent-2.1] COMPLETE`

---

## Completed Work

Built the full Express REST API for Workspaces, Tasks, and Comments with Zod
validation, `authenticateToken` on every route, and a central structured error
handler. All routers mount on the existing app alongside `/api/auth`.

### Files Created

| File | Purpose |
|------|---------|
| `src/middleware/validate.ts` | `validate({ body?, query?, params? })` — parses each request part with Zod, writes the coerced result back onto the request, and forwards `ZodError` to the error handler. |
| `src/middleware/errorHandler.ts` | `HttpError` class (+ `badRequest/unauthorized/forbidden/notFound/conflict` helpers), `asyncHandler` wrapper, `notFoundHandler`, and the central `errorHandler`. Maps `ZodError`, `HttpError`, and `Prisma.PrismaClientKnownRequestError` (P2025/P2002/P2003) to structured JSON. |
| `src/lib/access.ts` | Shared authorization: `requireWorkspaceAccess`, `requireWorkspaceOwner`, `canManageMembers`. Owner is always treated as having access. |
| `src/workspaces/router.ts` | Workspace CRUD + member management. |
| `src/tasks/router.ts` | Task CRUD + filtering + status-only update. |
| `src/comments/router.ts` | Comment CRUD scoped to a task (`mergeParams` router). |

### Files Modified

| File | Change |
|------|--------|
| `src/server.ts` | Mounts `/api/workspaces`, `/api/tasks`, `/api/tasks/:taskId/comments`; replaced the inline 404/500 handlers with `notFoundHandler` + `errorHandler`. |
| `package.json` | **Restored** the runtime/dev dependencies (express, cors, cookie-parser, bcrypt, jsonwebtoken, passport(+strategies), zod, dotenv, typescript, ts-node-dev, @types/*). These were lost when the wave1 merge overwrote agent-1.2's `package.json` with agent-1.1's prisma-only one (see Coordination Notes). |
| `prisma/schema.prisma` | Added the `AuthToken` model + `User.authTokens` relation that agent-1.2's auth code already depends on (see Coordination Notes). |
| `src/auth/oauth.ts` | One-line fix: `name: profile.name ?? profile.email` — schema `User.name` is non-null but the OAuth profile name is nullable (pre-existing typecheck error). |

---

## API Contracts

Base paths, all routes require `Authorization: Bearer <access>` (or `accessToken` cookie).
All errors use `{ "error": { "code": string, "message": string, "details"?: unknown } }`.

### Workspaces — `/api/workspaces`
| Method | Path | Body / Notes | Success |
|--------|------|--------------|---------|
| POST | `/` | `{ name }` — slug auto-generated; creator added as `OWNER` member | `201 { workspace }` |
| GET | `/` | lists workspaces the caller owns or belongs to | `200 { workspaces }` |
| GET | `/:id` | requires access | `200 { workspace }` (owner, members, counts) |
| PATCH | `/:id` | `{ name }` — owner/admin only | `200 { workspace }` |
| DELETE | `/:id` | owner only (cascade) | `204` |
| POST | `/:id/members` | `{ userId, role? }` — owner/admin only | `201 { member }` |
| DELETE | `/:id/members/:userId` | owner/admin, or self-leave; owner cannot be removed | `204` |

### Tasks — `/api/tasks`
| Method | Path | Body / Notes | Success |
|--------|------|--------------|---------|
| POST | `/` | `{ title, description?, workspaceId, assigneeId?, dueDate?, priority?, status? }` — caller must have workspace access; assignee must be a workspace member | `201 { task }` |
| GET | `/` | filters `?workspace=&status=&priority=&assignee=&search=`; without `workspace`, spans all accessible workspaces; `search` matches title/description (insensitive) | `200 { tasks }` (assignee + comment count) |
| GET | `/:id` | requires access | `200 { task }` (creator, assignee, comment/attachment counts) |
| PATCH | `/:id` | any of `title, description, assigneeId, dueDate, priority, status` (≥1 required) | `200 { task }` |
| PATCH | `/:id/status` | `{ status }` | `200 { task }` |
| DELETE | `/:id` | task creator or workspace owner | `204` |

### Comments — `/api/tasks/:taskId/comments`
| Method | Path | Body / Notes | Success |
|--------|------|--------------|---------|
| POST | `/` | `{ content }` — requires task access | `201 { comment }` |
| GET | `/` | list (oldest→newest) | `200 { comments }` |
| PATCH | `/:commentId` | `{ content }` — author only | `200 { comment }` |
| DELETE | `/:commentId` | author or workspace owner | `204` |

### Error codes
`VALIDATION_ERROR`(400), `BAD_REQUEST`(400), `UNAUTHORIZED`(401),
`AUTH_TOKEN_MISSING/EXPIRED/INVALID`(401, from auth middleware), `FORBIDDEN`(403),
`NOT_FOUND`(404), `CONFLICT`(409), `FOREIGN_KEY_VIOLATION`/`DATABASE_ERROR`(400),
`INTERNAL_ERROR`(500).

---

## Test Results

- `npx tsc --noEmit` → **PASS** (0 errors; whole project, including auth).
- Runtime smoke test (temporary file, run then removed), `JWT_SECRET` set, **no DB**:
  - `GET /api/health` → `200 {status:"ok",...}`
  - `GET /api/workspaces` (no token) → `401 AUTH_TOKEN_MISSING`
  - `GET /api/bogus` → `404 NOT_FOUND`
  - `GET /api/tasks/not-a-uuid` (valid token) → `400 VALIDATION_ERROR` (field `id`)
  - `POST /api/workspaces` `{}` → `400 VALIDATION_ERROR` (field `name`)
  - `PATCH /api/tasks/:id/status` `{status:"BOGUS"}` → `400 VALIDATION_ERROR`
  - `POST /api/workspaces` `{name:"Valid Name"}` → reaches Prisma, fails gracefully (no crash) because `DATABASE_URL` points at no live DB.

> **DB-backed happy paths were not exercised end-to-end** — there is no running Postgres. Validation, auth guarding, routing, and error serialisation are all confirmed. Run a live DB (below) to verify persistence.

---

## Coordination Notes (IMPORTANT — read before next steps)

1. **`package.json` was clobbered by the wave1 merge.** Commit `307df8b` merged
   agent-1.1's prisma-only `package.json`, dropping every dependency agent-1.2
   installed (express, zod, typescript, …). The source still imported them, so
   the project could not typecheck or run. I restored a full `package.json` and
   ran `npm install`. **If a later merge reintroduces a stripped `package.json`,
   re-add these deps.**
2. **Added `AuthToken` model to `prisma/schema.prisma`.** agent-1.2's
   `src/auth/router.ts` uses `prisma.authToken` for refresh-token
   persistence/revocation, but agent-1.1's schema never defined it, so the
   generated client lacked the delegate (3 typecheck errors). I added:
   ```prisma
   model AuthToken { id, userId, token @unique, type, expiresAt, createdAt; user @relation cascade; @@index([userId]); @@map("auth_tokens") }
   ```
   plus `User.authTokens`. This makes the documented refresh-token revocation
   actually function. **A migration is still required** (`prisma migrate dev`)
   before it exists at the SQL layer.
3. **Owner membership row.** Creating a workspace now also inserts a
   `WorkspaceMember` row with role `OWNER`, so membership queries are uniform.
   Authorization still treats `Workspace.ownerId` as authoritative for
   owner-only actions.

---

## Handoff Instructions (next waves)

1. **Set up a DB and migrate:** point `DATABASE_URL` at Postgres, then
   `npx prisma migrate dev --name wave2_authtoken` (picks up the new `AuthToken`
   model), and `npx prisma generate` if needed.
2. **Run the API:** `npm run dev` (ts-node-dev) or `npm run build && npm start`.
   Requires `JWT_SECRET` (+ `DATABASE_URL`).
3. **Reuse the building blocks:** import `authenticateToken` from
   `src/auth/middleware`, `validate` from `src/middleware/validate`, and throw
   `HttpError`/wrap handlers with `asyncHandler` from
   `src/middleware/errorHandler` so new routes inherit the structured-error
   contract. Use `requireWorkspaceAccess`/`requireWorkspaceOwner` from
   `src/lib/access` for authorization.
4. **Realtime (2.2):** the comments/tasks routers are the write path; emit
   socket events after successful `prisma.*.create/update/delete` if wiring live
   updates. `req.user!.id` is the authenticated actor.
5. **Mount order:** in `src/server.ts`, keep new routers **before**
   `notFoundHandler`, and `errorHandler` **last**.
