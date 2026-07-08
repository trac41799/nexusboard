import 'dotenv/config';
import path from 'path';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',

  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',

  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/nexusboard',

  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET ?? 'dev-jwt-refresh-secret-change-in-production',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },

  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
  },

  oauthSuccessRedirect: process.env.OAUTH_SUCCESS_REDIRECT ?? 'http://localhost:5173/oauth/callback',

  rateLimit: {
    windowMs: Number(process.env.RATELIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    max: Number(process.env.RATELIMIT_MAX ?? 100),
  },

  upload: {
    dest: path.resolve(__dirname, '..', 'uploads'),
    maxFileSize: Number(process.env.UPLOAD_MAX_FILE_SIZE ?? 10 * 1024 * 1024),
  },
} as const;
