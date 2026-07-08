import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { sendError, isWorkspaceMember } from '../lib/access';
import { authenticateToken } from '../auth/middleware';

/**
 * Message CRUD + typing indicators for NexusBoard chat.
 *
 * Base path (mounted in src/server.ts): `/api/messages`.
 * All routes require a valid access token. Read/write access is scoped to the
 * workspace that owns the message's channel; edit/delete are restricted to the
 * message author.
 *
 * Message model (prisma/schema.prisma):
 *   { id, content, channelId, userId, createdAt, editedAt? }
 *
 * The `/typing` endpoint is a stateless indicator hook. The persistent chat
 * transport is Socket.IO (Wave 2.2 `src/socket/*`); this REST endpoint lets
 * non-socket clients publish typing intent and returns the canonical
 * `typing:start` / `typing:stop` event payload the socket layer emits.
 */

const router = Router();

router.use(authenticateToken);

const AUTHOR_INCLUDE = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;

/* ------------------------------------------------------------------ *
 * Validation schemas
 * ------------------------------------------------------------------ */

const listQuerySchema = z.object({
  channel: z.string().uuid('channel must be a valid UUID'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.coerce.date().optional(),
});

const createMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(4000),
  channelId: z.string().uuid('channelId must be a valid UUID'),
});

const updateMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(4000),
});

const typingSchema = z.object({
  channelId: z.string().uuid('channelId must be a valid UUID'),
  isTyping: z.boolean(),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Resolves the workspace for a channel and verifies membership. */
async function authorizeChannelAccess(
  userId: string,
  channelId: string,
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return { ok: false, status: 404, code: 'CHANNEL_NOT_FOUND', message: 'Channel does not exist' };
  }
  if (!(await isWorkspaceMember(userId, channel.workspaceId))) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'You are not a member of this workspace' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * GET /api/messages?channel=:id&limit=&before=  — list channel messages
 * ------------------------------------------------------------------ */

router.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid message query', parsed.error.flatten());
  }
  const { channel, limit, before } = parsed.data;

  try {
    const access = await authorizeChannelAccess(req.user!.id, channel);
    if (!access.ok) {
      return sendError(res, access.status, access.code, access.message);
    }
    const messages = await prisma.message.findMany({
      where: { channelId: channel, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit ?? 50,
      include: AUTHOR_INCLUDE,
    });
    return res.status(200).json({ messages });
  } catch (err) {
    console.error('[messages] list failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list messages');
  }
});

/* ------------------------------------------------------------------ *
 * POST /api/messages/typing  — publish a typing indicator
 * ------------------------------------------------------------------ */

router.post('/typing', async (req: Request, res: Response) => {
  const parsed = typingSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid typing payload', parsed.error.flatten());
  }
  const { channelId, isTyping } = parsed.data;

  try {
    const access = await authorizeChannelAccess(req.user!.id, channelId);
    if (!access.ok) {
      return sendError(res, access.status, access.code, access.message);
    }
    const event = {
      event: isTyping ? 'typing:start' : 'typing:stop',
      channelId,
      userId: req.user!.id,
      room: `channel:${channelId}`,
      timestamp: new Date().toISOString(),
    };
    return res.status(200).json(event);
  } catch (err) {
    console.error('[messages] typing failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to publish typing indicator');
  }
});

/* ------------------------------------------------------------------ *
 * POST /api/messages  — send a message
 * ------------------------------------------------------------------ */

router.post('/', async (req: Request, res: Response) => {
  const parsed = createMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid message payload', parsed.error.flatten());
  }
  const { content, channelId } = parsed.data;

  try {
    const access = await authorizeChannelAccess(req.user!.id, channelId);
    if (!access.ok) {
      return sendError(res, access.status, access.code, access.message);
    }
    const message = await prisma.message.create({
      data: { content, channelId, userId: req.user!.id },
      include: AUTHOR_INCLUDE,
    });
    return res.status(201).json({ message });
  } catch (err) {
    console.error('[messages] create failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to send message');
  }
});

/* ------------------------------------------------------------------ *
 * GET /api/messages/:id  — fetch a single message
 * ------------------------------------------------------------------ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const message = await prisma.message.findUnique({
      where: { id: req.params.id },
      include: AUTHOR_INCLUDE,
    });
    if (!message) {
      return sendError(res, 404, 'MESSAGE_NOT_FOUND', 'Message does not exist');
    }
    const access = await authorizeChannelAccess(req.user!.id, message.channelId);
    if (!access.ok) {
      return sendError(res, access.status, access.code, access.message);
    }
    return res.status(200).json({ message });
  } catch (err) {
    console.error('[messages] get failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load message');
  }
});

/* ------------------------------------------------------------------ *
 * PATCH /api/messages/:id  — edit a message (author only)
 * ------------------------------------------------------------------ */

router.patch('/:id', async (req: Request, res: Response) => {
  const parsed = updateMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid message update payload', parsed.error.flatten());
  }

  try {
    const message = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!message) {
      return sendError(res, 404, 'MESSAGE_NOT_FOUND', 'Message does not exist');
    }
    if (message.userId !== req.user!.id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only edit your own messages');
    }
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { content: parsed.data.content, editedAt: new Date() },
      include: AUTHOR_INCLUDE,
    });
    return res.status(200).json({ message: updated });
  } catch (err) {
    console.error('[messages] update failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to edit message');
  }
});

/* ------------------------------------------------------------------ *
 * DELETE /api/messages/:id  — delete a message (author only)
 * ------------------------------------------------------------------ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const message = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!message) {
      return sendError(res, 404, 'MESSAGE_NOT_FOUND', 'Message does not exist');
    }
    if (message.userId !== req.user!.id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only delete your own messages');
    }
    await prisma.message.delete({ where: { id: message.id } });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[messages] delete failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete message');
  }
});

export default router;
