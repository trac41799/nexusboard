import { Response } from 'express';
import prisma from './prisma';
import { ApiError } from '../auth/types';

/**
 * Shared HTTP helpers + workspace-scoped authorization utilities used by the
 * Wave 2.2 chat/notification routers. Mirrors the structured error shape from
 * `src/auth/router.ts` so every endpoint returns a consistent
 * `{ error: { code, message, details? } }` body.
 */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  res.status(status).json(body);
}

/** True if the user owns or is a member of the workspace. */
export async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const [membership, ownedWorkspace] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    }),
    prisma.workspace.findFirst({ where: { id: workspaceId, ownerId: userId } }),
  ]);
  return Boolean(membership) || Boolean(ownedWorkspace);
}
