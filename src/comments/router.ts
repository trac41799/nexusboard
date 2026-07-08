import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticateToken } from '../auth/middleware';
import { validate } from '../middleware/validate';
import { asyncHandler, HttpError } from '../middleware/errorHandler';
import { requireWorkspaceAccess } from '../lib/access';

// mergeParams so `:taskId` from the parent mount path is available here.
const router = Router({ mergeParams: true });

router.use(authenticateToken);

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const taskParams = z.object({ taskId: z.string().uuid('Invalid task id') });

const commentParams = z.object({
  taskId: z.string().uuid('Invalid task id'),
  commentId: z.string().uuid('Invalid comment id'),
});

const contentBody = z.object({
  content: z.string().trim().min(1, 'Content is required').max(10_000),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function requireTaskAccess(taskId: string, userId: string): Promise<string> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { workspaceId: true } });
  if (!task) {
    throw HttpError.notFound('Task not found');
  }
  await requireWorkspaceAccess(userId, task.workspaceId);
  return task.workspaceId;
}

/* ------------------------------------------------------------------ *
 * POST /api/tasks/:taskId/comments — create
 * ------------------------------------------------------------------ */

router.post(
  '/',
  validate({ params: taskParams, body: contentBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { taskId } = req.params;
    const { content } = req.body as z.infer<typeof contentBody>;

    await requireTaskAccess(taskId, userId);

    const comment = await prisma.comment.create({
      data: { content, taskId, authorId: userId },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    res.status(201).json({ comment });
  }),
);

/* ------------------------------------------------------------------ *
 * GET /api/tasks/:taskId/comments — list
 * ------------------------------------------------------------------ */

router.get(
  '/',
  validate({ params: taskParams }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { taskId } = req.params;

    await requireTaskAccess(taskId, userId);

    const comments = await prisma.comment.findMany({
      where: { taskId },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json({ comments });
  }),
);

/* ------------------------------------------------------------------ *
 * PATCH /api/tasks/:taskId/comments/:commentId — update (author only)
 * ------------------------------------------------------------------ */

router.patch(
  '/:commentId',
  validate({ params: commentParams, body: contentBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { taskId, commentId } = req.params;
    const { content } = req.body as z.infer<typeof contentBody>;

    await requireTaskAccess(taskId, userId);

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.taskId !== taskId) {
      throw HttpError.notFound('Comment not found');
    }
    if (comment.authorId !== userId) {
      throw HttpError.forbidden('Only the author can edit this comment');
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    res.status(200).json({ comment: updated });
  }),
);

/* ------------------------------------------------------------------ *
 * DELETE /api/tasks/:taskId/comments/:commentId — delete (author or owner)
 * ------------------------------------------------------------------ */

router.delete(
  '/:commentId',
  validate({ params: commentParams }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { taskId, commentId } = req.params;

    const workspaceId = await requireTaskAccess(taskId, userId);

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.taskId !== taskId) {
      throw HttpError.notFound('Comment not found');
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    const isAuthor = comment.authorId === userId;
    const isOwner = workspace?.ownerId === userId;
    if (!isAuthor && !isOwner) {
      throw HttpError.forbidden('Only the author or workspace owner can delete this comment');
    }

    await prisma.comment.delete({ where: { id: commentId } });
    res.status(204).send();
  }),
);

export default router;
