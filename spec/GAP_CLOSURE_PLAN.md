# GAP CLOSURE PLAN: NexusBoard

**Target**: Full-stack team collaboration platform (Node.js + Express + Prisma + React + Socket.IO)

**Date**: 2026-07-08

**Orchestrator**: SourceForge v0.9.12 with OpenCode agents

---

## Phase 1: Foundation (WAVE 1 — parallel)

#### Step 1.1: Database Schema
- **Objective**: Design and create the complete Prisma schema for NexusBoard
- **Files to create**: `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`
- **Files to modify**: N/A (fresh project)
- **Details**: 
  - Models: User, Workspace, WorkspaceMember, Task, TaskAssignment, Comment, Channel, Message, Attachment, Notification, AuthToken, AuditLog
  - User has: id, email, name, avatar_url, password_hash, oauth_provider, oauth_id, created_at, updated_at
  - Workspace has: id, name, slug, owner_id, created_at, updated_at
  - Task has: id, title, description, status (TODO/IN_PROGRESS/REVIEW/DONE), priority (LOW/MEDIUM/HIGH/URGENT), workspace_id, creator_id, assignee_id, due_date, created_at, updated_at
  - Channel has: id, name, type (TEXT/VOICE), workspace_id, created_at
  - Message has: id, content, channel_id, user_id, created_at, edited_at
  - Notification has: id, user_id, type, title, body, read, link, created_at
  - All tables have createdAt/updatedAt with `@default(now())` and `@updatedAt`
  - Use PostgreSQL as the database provider

#### Step 1.2: Authentication System
- **Objective**: Implement JWT-based authentication with registration, login, logout, and OAuth2 (Google/GitHub)
- **Files to create**: `src/auth/router.ts`, `src/auth/middleware.ts`, `src/auth/passport.ts`, `src/auth/jwt.ts`, `src/auth/oauth.ts`
- **Files to modify**: `src/server.ts`
- **Details**:
  - POST `/api/auth/register` — email + password + name, returns JWT
  - POST `/api/auth/login` — email + password, returns JWT
  - POST `/api/auth/logout` — invalidates token
  - POST `/api/auth/refresh` — refresh token endpoint
  - GET `/api/auth/me` — returns current user profile
  - Google OAuth: passport-google-oauth20 strategy
  - GitHub OAuth: passport-github2 strategy
  - JWT: access token (15min) + refresh token (7 days)
  - Middleware: `authenticateToken` function for protected routes
  - bcrypt for password hashing
  - Environment vars: JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET

---

## Phase 2: Core API & Real-time (WAVE 2 — sequential after WAVE 1)

#### Step 2.1: REST API Layer
- **Objective**: Build Express server with all CRUD endpoints for workspaces, tasks, comments
- **Files to create**: `src/server.ts`, `src/workspaces/router.ts`, `src/tasks/router.ts`, `src/comments/router.ts`, `src/middleware/errorHandler.ts`, `src/middleware/validate.ts`
- **Files to modify**: `package.json`, `tsconfig.json`
- **Details**:
  - Express server on port 3000 with CORS, JSON body parser, cookie parser
  - Workspaces: CRUD, POST `/api/workspaces/:id/members`
  - Tasks: CRUD within a workspace, PATCH `/api/tasks/:id/status`, GET `/api/tasks?workspace=:id&status=&priority=&assignee=`
  - Comments: CRUD on tasks
  - Zod validation on all endpoints
  - Central error handler with structured JSON errors
  - Health check: GET `/api/health` returns DB status, uptime

#### Step 2.2: Real-time Engine
- **Objective**: Implement Socket.IO for real-time task updates, chat, and notifications
- **Files to create**: `src/socket/handler.ts`, `src/socket/auth.ts`, `src/socket/rooms.ts`
- **Files to modify**: `src/server.ts`
- **Details**:
  - Socket.IO server attached to Express HTTP server
  - JWT auth on socket connection (token in handshake query)
  - Join workspace rooms on connect (`workspace:<id>`)
  - Channel rooms: `channel:<id>`
  - Events:
    - `task:updated` — broadcast to workspace when task changes
    - `task:created` — broadcast new task
    - `message:send` / `message:received` — channel chat
    - `notification:new` — push to specific user
    - `typing:start` / `typing:stop` — typing indicators in channels
    - `presence:online` / `presence:offline` — user presence
  - Rate limiting per socket
  - Connection/disconnection logging

---
