import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { sendError, isWorkspaceMember } from '../lib/access';
import { authenticateToken } from '../auth/middleware';

/**
 * Channel CRUD for NexusBoard chat.
 *
 * Base path (mounted in src/server.ts): `/api/channels`.
 * All routes require a valid access token (`authenticateToken`). Every
 * operation is scoped to a workspace the caller belongs to.
 *
 * Channel model (prisma/schema.prisma):
 *   { id, name, type: TEXT|VOICE, workspaceId, createdAt }
 */

const router = Router();

router.use(authenticateToken);

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const createChannelSchema = z.object({
  name: z.string().min(1, 'Channel name is required').max(100),
  type: z.enum(['TEXT', 'VOICE']).optional(),
  workspaceId: z.string().uuid('workspaceId must be a valid UUID'),
});

const updateChannelSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    type: z.enum(['TEXT', 'VOICE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field (name, type) must be provided',
  });

const listQuerySchema = z.object({
  workspace: z.string().uuid('workspace must be a valid UUID'),
});

/* ------------------------------------------------------------------ *
 * GET /api/channels?workspace=:id  — list channels in a workspace
 * ------------------------------------------------------------------ */

router.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'A workspace query parameter is required', parsed.error.flatten());
  }
  const { workspace } = parsed.data;

  try {
    if (!(await isWorkspaceMember(req.user!.id, workspace))) {
      return sendError(res, 403, 'FORBIDDEN', 'You are not a member of this workspace');
    }
    const channels = await prisma.channel.findMany({
      where: { workspaceId: workspace },
      orderBy: { createdAt: 'asc' },
    });
    return res.status(200).json({ channels });
  } catch (err) {
    console.error('[channels] list failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list channels');
  }
});

/* ------------------------------------------------------------------ *
 * POST /api/channels  — create a channel
 * ------------------------------------------------------------------ */

router.post('/', async (req: Request, res: Response) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid channel payload', parsed.error.flatten());
  }
  const { name, type, workspaceId } = parsed.data;

  try {
    if (!(await isWorkspaceMember(req.user!.id, workspaceId))) {
      return sendError(res, 403, 'FORBIDDEN', 'You are not a member of this workspace');
    }
    const channel = await prisma.channel.create({
      data: { name, workspaceId, ...(type ? { type } : {}) },
    });
    return res.status(201).json({ channel });
  } catch (err) {
    console.error('[channels] create failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create channel');
  }
});

/* ------------------------------------------------------------------ *
 * GET /api/channels/:id  — fetch a single channel
 * ------------------------------------------------------------------ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      return sendError(res, 404, 'CHANNEL_NOT_FOUND', 'Channel does not exist');
    }
    if (!(await isWorkspaceMember(req.user!.id, channel.workspaceId))) {
      return sendError(res, 403, 'FORBIDDEN', 'You are not a member of this workspace');
    }
    return res.status(200).json({ channel });
  } catch (err) {
    console.error('[channels] get failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load channel');
  }
});

/* ------------------------------------------------------------------ *
 * PATCH /api/channels/:id  — update a channel
 * ------------------------------------------------------------------ */

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = updateChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid channel update payload', parsed.error.flatten());
  }

  try {
    const channel = await prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      return sendError(res, 404, 'CHANNEL_NOT_FOUND', 'Channel does not exist');
    }
    if (!(await isWorkspaceMember(req.user!.id, channel.workspaceId))) {
      return sendError(res, 403, 'FORBIDDEN', 'You are not a member of this workspace');
    }
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: parsed.data,
    });
    return res.status(200).json({ channel: updated });
  } catch (err) {
    console.error('[channels] update failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update channel');
  }
});

/* ------------------------------------------------------------------ *
 * DELETE /api/channels/:id  — delete a channel (cascades to messages)
 * ------------------------------------------------------------------ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) {
      return sendError(res, 404, 'CHANNEL_NOT_FOUND', 'Channel does not exist');
    }
    if (!(await isWorkspaceMember(req.user!.id, channel.workspaceId))) {
      return sendError(res, 403, 'FORBIDDEN', 'You are not a member of this workspace');
    }
    await prisma.channel.delete({ where: { id: channel.id } });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[channels] delete failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete channel');
  }
});

export default router;
