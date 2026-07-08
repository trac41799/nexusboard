import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import authRouter from './auth/router';
import workspacesRouter from './workspaces/router';
import tasksRouter from './tasks/router';
import commentsRouter from './comments/router';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

/* ------------------------------------------------------------------ *
 * Global middleware
 * ------------------------------------------------------------------ */

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/tasks/:taskId/comments', commentsRouter);

/* ------------------------------------------------------------------ *
 * 404 + error handling
 * ------------------------------------------------------------------ */

app.use(notFoundHandler);
app.use(errorHandler);

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] NexusBoard API listening on http://localhost:${PORT}`);
  });
}

export default app;
