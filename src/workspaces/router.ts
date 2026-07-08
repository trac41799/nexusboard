import { Router } from 'express';
import { z } from 'zod';
import { WorkspaceRole } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticateToken } from '../auth/middleware';
import { validate } from '../middleware/validate';
import { asyncHandler, HttpError } from '../middleware/errorHandler';
import { canManageMembers, requireWorkspaceAccess, requireWorkspaceOwner } from '../lib/access';

const router = Router();

router.use(authenticateToken);

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const idParams = z.object({ id: z.string().uuid('Invalid workspace id') });

const createBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
});

const updateBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
});

const addMemberBody = z.object({
  userId: z.string().uuid('Invalid user id'),
  role: z.nativeEnum(WorkspaceRole).optional(),
});

const memberParams = z.object({
  id: z.string().uuid('Invalid workspace id'),
  userId: z.string().uuid('Invalid user id'),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || 'workspace'}-${suffix}`;
}

/* ------------------------------------------------------------------ *
 * POST /api/workspaces — create
 * ------------------------------------------------------------------ */

router.post(
  '/',
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { name } = req.body as z.infer<typeof createBody>;

    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug: slugify(name),
        ownerId: userId,
        members: {
          create: { userId, role: WorkspaceRole.OWNER },
        },
      },
      include: { _count: { select: { members: true, tasks: true } } },
    });

    res.status(201).json({ workspace });
  }),
);

/* ------------------------------------------------------------------ *
 * GET /api/workspaces — list caller's workspaces
 * ------------------------------------------------------------------ */

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const workspaces = await prisma.workspace.findMany({
      where: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      include: { _count: { select: { members: true, tasks: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ workspaces });
  }),
);

/* ------------------------------------------------------------------ *
 * GET /api/workspaces/:id — details
 * ------------------------------------------------------------------ */

router.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    await requireWorkspaceAccess(userId, id);

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { tasks: true, channels: true } },
      },
    });

    res.status(200).json({ workspace });
  }),
);

/* ------------------------------------------------------------------ *
 * PATCH /api/workspaces/:id — update name
 * ------------------------------------------------------------------ */

router.patch(
  '/:id',
  validate({ params: idParams, body: updateBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name } = req.body as z.infer<typeof updateBody>;

    const { isOwner, membership } = await requireWorkspaceAccess(userId, id);
    if (!canManageMembers(isOwner, membership)) {
      throw HttpError.forbidden('Only an owner or admin can update the workspace');
    }

    const workspace = await prisma.workspace.update({ where: { id }, data: { name } });
    res.status(200).json({ workspace });
  }),
);

/* ------------------------------------------------------------------ *
 * DELETE /api/workspaces/:id — delete (owner only, cascade)
 * ------------------------------------------------------------------ */

router.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    await requireWorkspaceOwner(userId, id);
    await prisma.workspace.delete({ where: { id } });

    res.status(204).send();
  }),
);

/* ------------------------------------------------------------------ *
 * POST /api/workspaces/:id/members — add member
 * ------------------------------------------------------------------ */

router.post(
  '/:id/members',
  validate({ params: idParams, body: addMemberBody }),
  asyncHandler(async (req, res) => {
    const callerId = req.user!.id;
    const { id } = req.params;
    const { userId, role } = req.body as z.infer<typeof addMemberBody>;

    const { isOwner, membership } = await requireWorkspaceAccess(callerId, id);
    if (!canManageMembers(isOwner, membership)) {
      throw HttpError.forbidden('Only an owner or admin can add members');
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw HttpError.notFound('User not found');
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: id } },
    });
    if (existing) {
      throw HttpError.conflict('User is already a member of this workspace');
    }

    const member = await prisma.workspaceMember.create({
      data: { userId, workspaceId: id, role: role ?? WorkspaceRole.MEMBER },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });

    res.status(201).json({ member });
  }),
);

/* ------------------------------------------------------------------ *
 * DELETE /api/workspaces/:id/members/:userId — remove member
 * ------------------------------------------------------------------ */

router.delete(
  '/:id/members/:userId',
  validate({ params: memberParams }),
  asyncHandler(async (req, res) => {
    const callerId = req.user!.id;
    const { id, userId } = req.params;

    const { isOwner, membership, ownerId } = await requireWorkspaceAccess(callerId, id);

    const removingSelf = callerId === userId;
    if (!removingSelf && !canManageMembers(isOwner, membership)) {
      throw HttpError.forbidden('Only an owner or admin can remove members');
    }
    if (userId === ownerId) {
      throw HttpError.badRequest('The workspace owner cannot be removed');
    }

    await prisma.workspaceMember.delete({
      where: { userId_workspaceId: { userId, workspaceId: id } },
    });

    res.status(204).send();
  }),
);

export default router;
