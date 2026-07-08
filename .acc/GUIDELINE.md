# GUIDELINE — Wave 1 Step 1.1: Database Schema

**Agent Ref:** agent-1.1
**Phase:** 1 (Foundation)
**Wave:** 1
**Depends On:** none

## Objective
Design and create the complete Prisma schema for NexusBoard with 10 models.

## Task
Create \prisma/schema.prisma\ with the PostgreSQL datasource and all models below. Then run \
px prisma generate\.

## Models to Create in schema.prisma

1. **User**: id (uuid), email (unique), name, avatar_url?, password_hash?, oauth_provider?, oauth_id?, createdAt, updatedAt
2. **Workspace**: id (uuid), name, slug (unique), ownerId → User, createdAt, updatedAt
3. **WorkspaceMember**: id, userId → User, workspaceId → Workspace, role (OWNER/ADMIN/MEMBER enum), joinedAt. @@unique([userId, workspaceId])
4. **Task**: id, title, description?, status (TODO/IN_PROGRESS/REVIEW/DONE enum default TODO), priority (LOW/MEDIUM/HIGH/URGENT enum default MEDIUM), workspaceId → Workspace, creatorId → User, assigneeId? → User?, dueDate?, createdAt, updatedAt
5. **Comment**: id, content, taskId → Task, authorId → User, createdAt, updatedAt
6. **Channel**: id, name, type (TEXT/VOICE enum default TEXT), workspaceId → Workspace, createdAt
7. **Message**: id, content, channelId → Channel, userId → User, createdAt, editedAt?
8. **Attachment**: id, filename, url, fileSize?, mimeType?, taskId? → Task?, messageId? → Message?, uploadedById → User, createdAt
9. **Notification**: id, userId → User, type, title, body, read (default false), link?, createdAt
10. **AuditLog**: id, userId → User, action, entityType, entityId, metadata (Json?), createdAt

## Requirements
- Datasource: postgresql, using DATABASE_URL from .env
- Add \@@map("snake_case_table_name")\ on all models
- Add \@@index\ on workspaceId (Task), userId (Notification), channelId (Message)
- Use \@default(uuid())\ for all UUID primary keys
- Use \@default(now())\ for all createdAt
- Use \@updatedAt\ for all updatedAt
- Add cascade deletes where appropriate (e.g., delete tasks when workspace is deleted)
- Run \
px prisma generate\ after creating the schema

## Files to Create
- \prisma/schema.prisma\

## Environment
- Working directory: D:\TRANSFER DATA\Coding\OpenCode\monolith-demo\.worktrees\wave1-1-1
- Node.js and TypeScript project with Express, Prisma, PostgreSQL, JWT, Socket.IO
- \package.json\ already has prisma and @prisma/client as dependencies

## Communication Protocol
Use \[ACC:STATUS from=agent-1.1]\ for status updates.
Use \[ACC:BLOCKER from=agent-1.1]\ for blockers.

## Handoff
When complete, create \HANDOFF_1.1.md\ in this worktree root with:
- Completed Work
- Test Results (does prisma generate succeed?)
- Interface Contracts Exposed (the Prisma client API generated)
- Files Modified (list all)
- Design Decisions (why this model structure?)
- Handoff Instructions (for the API team in Wave 2)
