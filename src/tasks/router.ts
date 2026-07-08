import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticateToken } from '../auth/middleware';
import { validate } from '../middleware/validate';
import { asyncHandler, HttpError } from '../middleware/errorHandler';
import { requireWorkspaceAccess } from '../lib/access';

const router = Router();

router.use(authenticateToken);

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const idParams = z.object({ id: z.string().uuid('Invalid task id') });

const createBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(10_000).optional(),
  workspaceId: z.string().uuid('Invalid workspace id'),
  assigneeId: z.string().uuid('Invalid assignee id').nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
});

const updateBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).nullable(),
    assigneeId: z.string().uuid('Invalid assignee id').nullable(),
    dueDate: z.coerce.date().nullable(),
    priority: z.nativeEnum(TaskPriority),
    status: z.nativeEnum(TaskStatus),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const statusBody = z.object({ status: z.nativeEnum(TaskStatus) });

const listQuery = z.object({
  workspace: z.string().uuid('Invalid workspace id').optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assignee: z.string().uuid('Invalid assignee id').optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function assertAssigneeIsMember(workspaceId: string, assigneeId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (workspace?.ownerId === assigneeId) {
    return;
  }
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: assigneeId, workspaceId } },
  });
  if (!membership) {
    throw HttpError.badRequest('Assignee must be a member of the workspace');
  }
}

async function loadTaskForAccess(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw HttpError.notFound('Task not found');
  }
  await requireWorkspaceAccess(userId, task.workspaceId);
  return task;
}

/* ------------------------------------------------------------------ *
 * POST /api/tasks — create
 * ------------------------------------------------------------------ */

router.post(
  '/',
  validate({ body: createBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const data = req.body as z.infer<typeof createBody>;

    await requireWorkspaceAccess(userId, data.workspaceId);
    if (data.assigneeId) {
      await assertAssigneeIsMember(data.workspaceId, data.assigneeId);
    }

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        workspaceId: data.workspaceId,
        creatorId: userId,
        assigneeId: data.assigneeId ?? null,
        dueDate: data.dueDate ?? null,
        priority: data.priority ?? TaskPriority.MEDIUM,
        status: data.status ?? TaskStatus.TODO,
      },
    });

    res.status(201).json({ task });
  }),
);

/* ------------------------------------------------------------------ *
 * GET /api/tasks — list with filters
 * ------------------------------------------------------------------ */

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { workspace, status, priority, assignee, search } =
      req.query as z.infer<typeof listQuery>;

    const where: Prisma.TaskWhereInput = {};

    if (workspace) {
      await requireWorkspaceAccess(userId, workspace);
      where.workspaceId = workspace;
    } else {
      where.workspace = {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      };
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignee) where.assigneeId = assignee;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { comments: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    res.status(200).json({ tasks });
  }),
);

/* ------------------------------------------------------------------ *
 * GET /api/tasks/:id — details with comments count
 * ------------------------------------------------------------------ */

router.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    await loadTaskForAccess(id, userId);

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatarUrl: true } },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { comments: true, attachments: true } },
      },
    });

    res.status(200).json({ task });
  }),
);

/* ------------------------------------------------------------------ *
 * PATCH /api/tasks/:id — update any field
 * ------------------------------------------------------------------ */

router.patch(
  '/:id',
  validate({ params: idParams, body: updateBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const data = req.body as z.infer<typeof updateBody>;

    const existing = await loadTaskForAccess(id, userId);

    if (data.assigneeId) {
      await assertAssigneeIsMember(existing.workspaceId, data.assigneeId);
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });

    res.status(200).json({ task });
  }),
);

/* ------------------------------------------------------------------ *
 * PATCH /api/tasks/:id/status — update status only
 * ------------------------------------------------------------------ */

router.patch(
  '/:id/status',
  validate({ params: idParams, body: statusBody }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;
    const { status } = req.body as z.infer<typeof statusBody>;

    await loadTaskForAccess(id, userId);
    const task = await prisma.task.update({ where: { id }, data: { status } });

    res.status(200).json({ task });
  }),
);

/* ------------------------------------------------------------------ *
 * DELETE /api/tasks/:id — delete (creator or workspace owner)
 * ------------------------------------------------------------------ */

router.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { id } = req.params;

    const task = await loadTaskForAccess(id, userId);
    const workspace = await prisma.workspace.findUnique({
      where: { id: task.workspaceId },
      select: { ownerId: true },
    });

    const isCreator = task.creatorId === userId;
    const isOwner = workspace?.ownerId === userId;
    if (!isCreator && !isOwner) {
      throw HttpError.forbidden('Only the task creator or workspace owner can delete this task');
    }

    await prisma.task.delete({ where: { id } });
    res.status(204).send();
  }),
);

export default router;
