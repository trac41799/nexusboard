import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticateToken } from '../auth/middleware';
import { config } from '../config';

const router = Router();
router.use(authenticateToken);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.upload.dest);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSize },
});

const getAttachmentsQuerySchema = z.object({
  taskId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
});

function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

router.get('/', async (req: Request, res: Response) => {
  const parsed = getAttachmentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', parsed.error.flatten());
  }

  const { taskId, messageId } = parsed.data;

  try {
    const attachments = await prisma.attachment.findMany({
      where: { taskId: taskId ?? undefined, messageId: messageId ?? undefined },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({ attachments });
  } catch (err) {
    console.error('[attachments] list failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list attachments');
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) {
      return sendError(res, 404, 'NOT_FOUND', 'Attachment not found');
    }
    return res.status(200).json({ attachment });
  } catch (err) {
    console.error('[attachments] get failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load attachment');
  }
});

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return sendError(res, 400, 'FILE_MISSING', 'No file was uploaded');
  }

  const taskId = req.body.taskId as string | undefined;
  const messageId = req.body.messageId as string | undefined;

  try {
    const attachment = await prisma.attachment.create({
      data: {
        filename: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        taskId: taskId || null,
        messageId: messageId || null,
        uploadedById: req.user!.id,
      },
    });

    return res.status(201).json({ attachment });
  } catch (err) {
    console.error('[attachments] upload failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to upload file');
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) {
      return sendError(res, 404, 'NOT_FOUND', 'Attachment not found');
    }

    if (attachment.uploadedById !== req.user!.id) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          userId: req.user!.id,
          role: { in: ['OWNER', 'ADMIN'] },
          workspace: {
            OR: [
              { tasks: { some: { attachments: { some: { id: attachment.id } } } } },
              { channels: { some: { messages: { some: { attachments: { some: { id: attachment.id } } } } } } },
            ],
          },
        },
      });

      if (!membership) {
        return sendError(res, 403, 'FORBIDDEN', 'You are not authorized to delete this attachment');
      }
    }

    await prisma.attachment.delete({ where: { id: attachment.id } });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[attachments] delete failed:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete attachment');
  }
});

export default router;
