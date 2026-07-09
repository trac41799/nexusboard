# NexusBoard

A full-stack team collaboration platform for managing workspaces, tasks, comments, and real-time updates. NexusBoard combines a REST API, a real-time Socket.IO layer, and a modern React single-page application into one cohesive codebase.

## Project Overview

NexusBoard lets teams create workspaces, invite members, track tasks through a Kanban-style status flow (To Do → In Progress → Review → Done), comment on work, and receive live updates as changes happen. Authentication supports both email/password (JWT) and OAuth2 (Google and GitHub).

## Tech Stack

- **Backend:** Node.js + Express
- **ORM / Database:** Prisma + PostgreSQL
- **Real-time:** Socket.IO
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Auth:** JWT (access + refresh tokens) and OAuth2 (Google / GitHub) via Passport
- **Uploads:** Multer (local filesystem)

## Setup

Prerequisites: Node.js 20+, a running PostgreSQL instance (or use the provided `docker-compose.yml`).

```bash
npm install
cp .env.example .env      # then edit values (DATABASE_URL, JWT secrets, OAuth keys)
npx prisma generate
npm run dev               # start the Vite dev server (frontend)
npm run dev:server        # in a second terminal, start the API + Socket.IO server
```

To apply the database schema during development:

```bash
npm run prisma:migrate
```

### Docker

```bash
docker compose up --build
```

This starts a PostgreSQL service and the NexusBoard API server.

## API Documentation

All routes are prefixed with `/api`. Authenticated routes require an `Authorization: Bearer <accessToken>` header.

| Method | Endpoint                     | Description                          | Auth |
| ------ | ---------------------------- | ------------------------------------ | ---- |
| GET    | `/api/health`                | Health check / uptime                | No   |
| POST   | `/api/auth/register`         | Create a new account                 | No   |
| POST   | `/api/auth/login`            | Log in with email + password         | No   |
| POST   | `/api/auth/logout`           | Invalidate the current session       | Yes  |
| POST   | `/api/auth/refresh`          | Exchange a refresh token             | No   |
| GET    | `/api/auth/me`               | Get the current user profile         | Yes  |
| GET    | `/api/auth/oauth/google`     | Start Google OAuth2 flow             | No   |
| GET    | `/api/auth/oauth/github`     | Start GitHub OAuth2 flow             | No   |
| GET    | `/api/workspaces`            | List workspaces for the current user | Yes  |
| POST   | `/api/workspaces`            | Create a workspace                   | Yes  |
| GET    | `/api/workspaces/:id`        | Get workspace detail + members       | Yes  |
| PATCH  | `/api/workspaces/:id`        | Update a workspace                   | Yes  |
| DELETE | `/api/workspaces/:id`        | Delete a workspace                   | Yes  |
| GET    | `/api/tasks?workspace=:id`   | List tasks in a workspace            | Yes  |
| POST   | `/api/tasks`                 | Create a task                        | Yes  |
| GET    | `/api/tasks/:id`             | Get a task                           | Yes  |
| PATCH  | `/api/tasks/:id/status`      | Update a task's status               | Yes  |
| DELETE | `/api/tasks/:id`             | Delete a task                        | Yes  |
| POST   | `/api/tasks/:taskId/comments`| Add a comment to a task              | Yes  |
| GET    | `/api/tasks/:taskId/comments`| List comments for a task             | Yes  |

## Environment Variables

See `.env.example` for the full, documented list. Summary:

| Variable                 | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `PORT`                   | Port the API/Socket.IO server listens on          |
| `NODE_ENV`               | `development` or `production`                     |
| `CLIENT_URL`             | SPA origin allowed by CORS                         |
| `APP_BASE_URL`           | Public base URL of the API server                  |
| `DATABASE_URL`           | PostgreSQL connection string                       |
| `JWT_SECRET`             | Secret for signing access tokens                   |
| `JWT_REFRESH_SECRET`     | Secret for signing refresh tokens                  |
| `GOOGLE_CLIENT_ID`       | Google OAuth2 client ID                            |
| `GOOGLE_CLIENT_SECRET`   | Google OAuth2 client secret                        |
| `GITHUB_CLIENT_ID`       | GitHub OAuth2 client ID                            |
| `GITHUB_CLIENT_SECRET`   | GitHub OAuth2 client secret                        |
| `OAUTH_SUCCESS_REDIRECT` | SPA route that receives OAuth callback tokens      |
| `RATELIMIT_WINDOW_MS`    | Rate-limit window in milliseconds                  |
| `RATELIMIT_MAX`          | Max requests per window per client                 |
| `UPLOAD_MAX_FILE_SIZE`   | Max upload size in bytes                           |
| `VITE_API_URL`           | API base URL used by the SPA at build time         |

## Architecture

NexusBoard is a monolith with a clear separation between the API server and the web client:

- **`src/server.ts`** — Express bootstrap: global middleware (CORS, JSON, cookies, Passport), route mounting, error handling, and the Socket.IO engine.
- **Feature modules** (`src/auth`, `src/workspaces`, `src/tasks`, `src/comments`, `src/channels`, `src/messages`, `src/notifications`, `src/attachments`) — each owns its Express router and business logic.
- **`src/socket`** — real-time Socket.IO handlers that broadcast `task:created` / `task:updated` events to workspace rooms.
- **`src/middleware`** — cross-cutting concerns such as authentication and centralized error handling.
- **`src/config.ts`** — centralized, environment-driven configuration (no hardcoded secrets).
- **Frontend** (`src/pages`, `src/components`, `src/api`, `src/hooks`) — the React SPA. `src/api/client.ts` wraps Axios with token injection and 401 handling; pages consume the REST API and subscribe to Socket.IO updates.
- **Prisma** (`prisma/schema.prisma`) — data model and migrations for PostgreSQL.

The frontend is served by Vite in development and proxies `/api` to the backend on port 3000. In production, set `VITE_API_URL` to the deployed API origin.
