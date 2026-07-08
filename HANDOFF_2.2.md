# HANDOFF 2.2 — Chat & Notifications REST API

**Agent Ref:** agent-2.2
**Phase:** 2 (Application) · **Wave:** 2
**Status:** `[ACC:STATUS from=agent-2.2] COMPLETE`

---

## Completed Work

Channel, message (with typing indicator), and notification (with mark-read)
REST routers, all wired into the shared Express app. Every route reuses the
`authenticateToken` middleware and the `prisma` singleton from Wave 1, and every
response follows the established `{ error: { code, message, details? } }` error
shape.

Files created:

| File | Purpose |
|------|---------|
| `src/channels/router.ts` | Channel CRUD, workspace-membership scoped. |
| `src/messages/router.ts` | Message CRUD + `POST /typing` indicator, channel/workspace scoped; edit/delete author-only. |
| `src/notifications/router.ts` | Notification CRUD + `PATCH /:id/read` + `PATCH /read-all`, owner-scoped. |
| `src/lib/access.ts` | Shared `sendError` helper + `isWorkspaceMember(userId, workspaceId)` authorization util. |

Files modified:

| File | Change |
|------|--------|
| `src/server.ts` | Mounted `/api/channels`, `/api/messages`, `/api/notifications` (after `/api/auth`, before the 404 handler). |

Dependencies installed into this worktree (were missing — only `@prisma/client`
was present): `express@^4`, `cors`, `cookie-parser`, `bcrypt`, `jsonwebtoken`,
`passport`, `passport-google-oauth20`, `passport-github2`, `zod`, `dotenv`,
`socket.io` (+ matching `@types/*`, `typescript@5.4.5`, `ts-node-dev`). Express
was pinned to v4 because the codebase targets Express 4 typings (Express 5's
`req.params` typing breaks the route handlers). `typescript@5.4.5` was chosen so
the existing `tsconfig.json` (`moduleResolution: "node"`) compiles without the
TS 5.5+ node10 deprecation error.

---

## Test Results

`npx tsc --noEmit` — **my files compile with 0 errors.**

Remaining 4 errors are **pre-existing** (present in the baseline before this
work began) and belong to the Wave 1 auth layer / schema coordination gap:

```
src/auth/oauth.ts(59,7):   TS2322 'string | null' not assignable to 'string'
src/auth/router.ts(99,18): TS2339 Property 'authToken' does not exist on PrismaClient
src/auth/router.ts(114,18): TS2339 Property 'authToken' does not exist on PrismaClient
src/auth/router.ts(123,33): TS2339 Property 'authToken' does not exist on PrismaClient
```

These are the exact coordination items flagged in HANDOFF_1.2.md "Design
Decisions #2": agent-1.2 assumed an `AuthToken` model that is **not** in
agent-1.1's `prisma/schema.prisma`. I did **not** touch the auth code or the
schema (out of scope for 2.2). To clear them: add an `AuthToken` model to the
schema and `npx prisma generate`, or make the auth helpers tolerate its absence
at the type level.

> DB-backed endpoints were not exercised end-to-end (no live Postgres in this
> worktree). They typecheck against the generated Prisma client for the
> `Channel`, `Message`, `Notification`, `Workspace`, and `WorkspaceMember`
> models.

---

## API Contracts

All routes require auth (`Authorization: Bearer <access>` or `accessToken`
cookie). Errors use `{ error: { code, message, details? } }`.

### `/api/channels`
| Method | Path | Body / Query | Success |
|--------|------|--------------|---------|
| GET | `/?workspace=:uuid` | — | `200 { channels: Channel[] }` |
| POST | `/` | `{ name, type?: "TEXT"\|"VOICE", workspaceId }` | `201 { channel }` |
| GET | `/:id` | — | `200 { channel }` |
| PATCH | `/:id` | `{ name?, type? }` (≥1 field) | `200 { channel }` |
| DELETE | `/:id` | — | `200 { success: true }` (cascades messages) |

### `/api/messages`
| Method | Path | Body / Query | Success |
|--------|------|--------------|---------|
| GET | `/?channel=:uuid&limit=&before=` | — | `200 { messages: Message[] }` (newest-first, incl. author) |
| POST | `/` | `{ content, channelId }` | `201 { message }` (author = caller) |
| POST | `/typing` | `{ channelId, isTyping: boolean }` | `200 { event: "typing:start"\|"typing:stop", channelId, userId, room, timestamp }` |
| GET | `/:id` | — | `200 { message }` |
| PATCH | `/:id` | `{ content }` | `200 { message }` (author-only, sets `editedAt`) |
| DELETE | `/:id` | — | `200 { success: true }` (author-only) |

### `/api/notifications`
| Method | Path | Body / Query | Success |
|--------|------|--------------|---------|
| GET | `/?read=true\|false&limit=` | — | `200 { notifications, unreadCount }` (own only) |
| POST | `/` | `{ userId, type, title, body, link? }` | `201 { notification }` |
| PATCH | `/read-all` | — | `200 { success: true, updated: n }` |
| PATCH | `/:id/read` | — | `200 { notification }` (own only) |
| GET | `/:id` | — | `200 { notification }` (own only) |
| PATCH | `/:id` | `{ title?, body?, link?, read? }` (≥1 field) | `200 { notification }` (own only) |
| DELETE | `/:id` | — | `200 { success: true }` (own only) |

Error codes introduced: `VALIDATION_ERROR`(400), `FORBIDDEN`(403),
`CHANNEL_NOT_FOUND`(404), `MESSAGE_NOT_FOUND`(404),
`NOTIFICATION_NOT_FOUND`(404), `INTERNAL_ERROR`(500).

---

## Design Decisions

1. **Workspace-scoped authorization.** Channels and messages verify
   `isWorkspaceMember` (owner *or* `WorkspaceMember` row) before any read/write,
   returning `403 FORBIDDEN` otherwise. Notifications are strictly owner-scoped
   (non-owners get `404` to avoid leaking existence).
2. **Author-only mutation.** Message edit/delete require `message.userId ===
   req.user!.id`; edits stamp `editedAt`.
3. **`POST /messages/typing` is a transport-agnostic hook.** The durable
   real-time path is Socket.IO (still to be built at `src/socket/*` per
   GAP_CLOSURE_PLAN Step 2.2). This endpoint validates + authorizes and returns
   the canonical `typing:start`/`typing:stop` payload (with `room:
   channel:<id>`) that the socket layer should emit, so the two layers share one
   event contract.
4. **Shared `sendError` + `isWorkspaceMember` in `src/lib/access.ts`.** Mirrors
   auth's local `sendError` but lifted to a lib so the three new routers (and
   future Wave 2.1 routers) stay DRY without duplicating the membership check.
5. **Pagination on message list.** `limit` (1–100, default 50) + `before`
   (createdAt cursor), newest-first — ready for infinite-scroll chat history.
6. **Scope discipline.** No changes to auth, schema, or tsconfig. Pre-existing
   auth typecheck errors were left untouched (see Test Results).

---

## Handoff Instructions (for Socket layer — Step 2.2 real-time / Wave 2.1 API)

1. **Socket layer** should emit into room `channel:<id>` for `message:received`
   and `typing:start`/`typing:stop`, and `notification:new` to the target user.
   The REST `POST /messages` and `POST /messages/typing` responses already match
   these payload shapes — reuse them, and call `verifyAccessToken` from
   `src/auth/jwt.ts` for handshake auth.
2. **Resolve the auth baseline errors** before shipping: add an `AuthToken`
   model to `prisma/schema.prisma` + `npx prisma generate`, then re-run
   `npx tsc --noEmit` for a fully green build.
3. **Reuse `isWorkspaceMember`** from `src/lib/access.ts` for any new
   workspace-scoped endpoints; do not re-implement membership checks.
4. **Env/run:** dependencies are installed here but `package.json` still lists
   only prisma — run `npm install` (with the above deps added to `package.json`)
   or `npm i` in a clean checkout, set `DATABASE_URL` + `JWT_SECRET`, then
   `npx prisma generate`.
