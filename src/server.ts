import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import authRouter from './auth/router';

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

/* ------------------------------------------------------------------ *
 * 404 + error handling
 * ------------------------------------------------------------------ */

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] NexusBoard API listening on http://localhost:${PORT}`);
  });
}

export default app;
