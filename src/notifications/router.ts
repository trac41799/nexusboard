import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { sendError } from '../lib/access';
import { authenticateToken } from '../auth/middleware';

/**
 * Notification CRUD + mark-read for NexusBoard.
 *
 * Base path (mounted in src/server.ts): `/api/notifications`.
 * All routes require a valid access token. A user may only list, read, update
 * or delete their own notifications. Creation targets an explicit `userId`
 * (used by the socket layer's `notification:new` push and by server-side
 * event producers).
 *
 * Notification model (prisma/schema.prisma):
 *   { id, userId, type, title, body, read (default false), link?, createdAt }
 */

const router = Router();

router.use(authenticateToken);

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const listQuerySchema = z.object({
  read: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createNotificationSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
  type: z.string().min(1, 'type is required').max(60),
  title: z.string().min(1, 'title is required').max(200),
  body: z.string().min(1, 'body is required').max(2000),
  link: z.string().url('link must be a valid URL').optional(),
});

const updateNotificationSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(2000).optional(),
    link: z.string().url().optional(),
    read: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field (title, body, link, read) must be provided',
  });

/* ------------------------------------------------------------------ *
 * GET /api/notifications?read=&limit=  — list the caller's notifications
 * ------------------------------------------------------------------ */

router.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid notification query', parsed.error.flatten());
  }
  const { read, limit } = parsed.data;

  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id, ...(read === undefined ? {} : { read }) },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 50,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, read: false } }),
    ]);
    return res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notifications] list failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list notifications');
  }
});

/* ------------------------------------------------------------------ *
 * POST /api/notifications  — create a notification for a user
 * ------------------------------------------------------------------ */

router.post('/', async (req: Request, res: Response) => {
  const parsed = createNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid notification payload', parsed.error.flatten());
  }
  const { userId, type, title, body, link } = parsed.data;

  try {
    const notification = await prisma.notification.create({
      data: { userId, type, title, body, ...(link ? { link } : {}) },
    });
    return res.status(201).json({ notification });
  } catch (err) {
    console.error('[notifications] create failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create notification');
  }
});

/* ------------------------------------------------------------------ *
 * PATCH /api/notifications/read-all  — mark every notification read
 * ------------------------------------------------------------------ */

router.patch('/read-all', async (req: Request, res: Response) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true },
    });
    return res.status(200).json({ success: true, updated: result.count });
  } catch (err) {
    console.error('[notifications] read-all failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to mark notifications read');
  }
});

/* ------------------------------------------------------------------ *
 * PATCH /api/notifications/:id/read  — mark a single notification read
 * ------------------------------------------------------------------ */

router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification does not exist');
    }
    const notification = await prisma.notification.update({
      where: { id: existing.id },
      data: { read: true },
    });
    return res.status(200).json({ notification });
  } catch (err) {
    console.error('[notifications] mark-read failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to mark notification read');
  }
});

/* ------------------------------------------------------------------ *
 * GET /api/notifications/:id  — fetch a single notification
 * ------------------------------------------------------------------ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification || notification.userId !== req.user!.id) {
      return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification does not exist');
    }
    return res.status(200).json({ notification });
  } catch (err) {
    console.error('[notifications] get failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load notification');
  }
});

/* ------------------------------------------------------------------ *
 * PATCH /api/notifications/:id  — update a notification
 * ------------------------------------------------------------------ */

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = updateNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid notification update payload', parsed.error.flatten());
  }

  try {
    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification does not exist');
    }
    const notification = await prisma.notification.update({
      where: { id: existing.id },
      data: parsed.data,
    });
    return res.status(200).json({ notification });
  } catch (err) {
    console.error('[notifications] update failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update notification');
  }
});

/* ------------------------------------------------------------------ *
 * DELETE /api/notifications/:id  — delete a notification
 * ------------------------------------------------------------------ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.id) {
      return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification does not exist');
    }
    await prisma.notification.delete({ where: { id: existing.id } });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[notifications] delete failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete notification');
  }
});

export default router;
