import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../auth/jwt';
import prisma from '../lib/prisma';
import { isWorkspaceMember } from '../lib/access';
import { workspaceRoom, channelRoom, userRoom } from './rooms';

/* ------------------------------------------------------------------ *
 * Event constants (shared contract between server and client)
 * ------------------------------------------------------------------ */

export const EVENTS = {
  TASK_UPDATED: 'task:updated',
  TASK_CREATED: 'task:created',
  MESSAGE_SEND: 'message:send',
  MESSAGE_RECEIVED: 'message:received',
  NOTIFICATION_NEW: 'notification:new',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  JOIN_WORKSPACE: 'join:workspace',
  LEAVE_WORKSPACE: 'leave:workspace',
  JOIN_CHANNEL: 'join:channel',
  LEAVE_CHANNEL: 'leave:channel',
} as const;

/* ------------------------------------------------------------------ *
 * Augmented socket interface
 * ------------------------------------------------------------------ */

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

/* ------------------------------------------------------------------ *
 * Singleton
 * ------------------------------------------------------------------ */

let io: Server;

export function getIO(): Server {
  return io;
}

/* ------------------------------------------------------------------ *
 * Initialisation
 * ------------------------------------------------------------------ */

export function createSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: (process.env.CLIENT_URL ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  /* ---------------------------------------------------------------- *
   * Auth middleware
   * ---------------------------------------------------------------- */

  io.use(async (socket: AuthenticatedSocket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('Authentication token is required'));
    }
    try {
      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      socket.userEmail = payload.email;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  /* ---------------------------------------------------------------- *
   * Connection handler
   * ---------------------------------------------------------------- */

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    console.log(`[socket] user connected: ${userId}`);

    socket.join(userRoom(userId));
    socket.broadcast.emit(EVENTS.PRESENCE_ONLINE, { userId });

    /* -------------------------------------------------------------- *
     * Workspace rooms
     * -------------------------------------------------------------- */

    socket.on(EVENTS.JOIN_WORKSPACE, async (workspaceId: unknown) => {
      if (typeof workspaceId !== 'string') return;
      try {
        const allowed = await isWorkspaceMember(userId, workspaceId);
        if (!allowed) {
          socket.emit('error', { message: 'Not a member of this workspace' });
          return;
        }
        socket.join(workspaceRoom(workspaceId));
      } catch (err) {
        console.error('[socket] join workspace error:', err);
      }
    });

    socket.on(EVENTS.LEAVE_WORKSPACE, (workspaceId: unknown) => {
      if (typeof workspaceId === 'string') {
        socket.leave(workspaceRoom(workspaceId));
      }
    });

    /* -------------------------------------------------------------- *
     * Channel rooms
     * -------------------------------------------------------------- */

    socket.on(EVENTS.JOIN_CHANNEL, async (channelId: unknown) => {
      if (typeof channelId !== 'string') return;
      try {
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { workspaceId: true },
        });
        if (!channel) {
          socket.emit('error', { message: 'Channel not found' });
          return;
        }
        const allowed = await isWorkspaceMember(userId, channel.workspaceId);
        if (!allowed) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
        socket.join(channelRoom(channelId));
      } catch (err) {
        console.error('[socket] join channel error:', err);
      }
    });

    socket.on(EVENTS.LEAVE_CHANNEL, (channelId: unknown) => {
      if (typeof channelId === 'string') {
        socket.leave(channelRoom(channelId));
      }
    });

    /* -------------------------------------------------------------- *
     * Message send (persist + broadcast)
     * -------------------------------------------------------------- */

    socket.on(EVENTS.MESSAGE_SEND, async (data: unknown) => {
      const payload = data as { channelId?: string; content?: string } | undefined;
      if (!payload?.channelId || !payload?.content) return;
      try {
        const channel = await prisma.channel.findUnique({
          where: { id: payload.channelId },
          select: { workspaceId: true },
        });
        if (!channel) {
          socket.emit('error', { message: 'Channel not found' });
          return;
        }
        const allowed = await isWorkspaceMember(userId, channel.workspaceId);
        if (!allowed) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }
        const message = await prisma.message.create({
          data: {
            content: payload.content,
            channelId: payload.channelId,
            userId,
          },
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
        });
        io.to(channelRoom(payload.channelId)).emit(EVENTS.MESSAGE_RECEIVED, message);
      } catch (err) {
        console.error('[socket] message send error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    /* -------------------------------------------------------------- *
     * Typing indicators (stateless relay)
     * -------------------------------------------------------------- */

    socket.on(EVENTS.TYPING_START, (data: unknown) => {
      const payload = data as { channelId?: string } | undefined;
      if (payload?.channelId) {
        socket.to(channelRoom(payload.channelId)).emit(EVENTS.TYPING_START, {
          userId,
          channelId: payload.channelId,
        });
      }
    });

    socket.on(EVENTS.TYPING_STOP, (data: unknown) => {
      const payload = data as { channelId?: string } | undefined;
      if (payload?.channelId) {
        socket.to(channelRoom(payload.channelId)).emit(EVENTS.TYPING_STOP, {
          userId,
          channelId: payload.channelId,
        });
      }
    });

    /* -------------------------------------------------------------- *
     * Disconnect
     * -------------------------------------------------------------- */

    socket.on('disconnect', () => {
      console.log(`[socket] user disconnected: ${userId}`);
      socket.broadcast.emit(EVENTS.PRESENCE_OFFLINE, { userId });
    });
  });

  return io;
}
