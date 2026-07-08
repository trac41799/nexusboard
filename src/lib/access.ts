import { Request, Response, NextFunction } from 'express';
import prisma from './prisma';
import { ApiError } from '../auth/types';
import { HttpError } from '../middleware/errorHandler';

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

export async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const [membership, ownedWorkspace] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    }),
    prisma.workspace.findFirst({ where: { id: workspaceId, ownerId: userId } }),
  ]);
  return Boolean(membership) || Boolean(ownedWorkspace);
}

export async function requireWorkspaceAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) return next(new HttpError(401, 'AUTH_TOKEN_MISSING', 'Authentication required'));
  const workspaceId = req.params.workspaceId || req.params.id;
  if (!workspaceId) return next(new HttpError(400, 'VALIDATION_ERROR', 'Workspace ID required'));
  const ok = await isWorkspaceMember(userId, workspaceId);
  if (!ok) return next(new HttpError(403, 'FORBIDDEN', 'Not a member of this workspace'));
  next();
}

export async function requireWorkspaceOwner(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) return next(new HttpError(401, 'AUTH_TOKEN_MISSING', 'Authentication required'));
  const workspaceId = req.params.workspaceId || req.params.id;
  if (!workspaceId) return next(new HttpError(400, 'VALIDATION_ERROR', 'Workspace ID required'));
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace || workspace.ownerId !== userId)
    return next(new HttpError(403, 'FORBIDDEN', 'Only the workspace owner can perform this action'));
  next();
}

export async function canManageMembers(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) return next(new HttpError(401, 'AUTH_TOKEN_MISSING', 'Authentication required'));
  const workspaceId = req.params.workspaceId || req.params.id;
  if (!workspaceId) return next(new HttpError(400, 'VALIDATION_ERROR', 'Workspace ID required'));
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return next(new HttpError(404, 'NOT_FOUND', 'Workspace not found'));
  if (workspace.ownerId === userId) return next();
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN'))
    return next(new HttpError(403, 'FORBIDDEN', 'Only owners and admins can manage members'));
  next();
}

/* ------------------------------------------------------------------ *
 * Direct-call helpers — throw {@link HttpError} on failure, else return.
 * Use these inside route handlers where an inline access check is needed.
 * ------------------------------------------------------------------ */

/** Throws unless `userId` is a member (or owner) of the workspace. */
export async function checkWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
  const ok = await isWorkspaceMember(userId, workspaceId);
  if (!ok) {
    throw HttpError.forbidden('Not a member of this workspace');
  }
}

/** Throws unless `userId` is the owner of the workspace. */
export async function checkWorkspaceOwner(userId: string, workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace || workspace.ownerId !== userId) {
    throw HttpError.forbidden('Only the workspace owner can perform this action');
  }
}

/** Throws unless `userId` is the owner or an admin of the workspace. */
export async function checkMemberManagement(userId: string, workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw HttpError.notFound('Workspace not found');
  }
  if (workspace.ownerId === userId) {
    return;
  }
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
    throw HttpError.forbidden('Only owners and admins can manage members');
  }
}
