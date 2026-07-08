import morgan from 'morgan';
import { config } from '../config';

export const requestLogger = morgan(
  config.isProduction ? 'combined' : 'dev',
  {
    skip: (_req, _res) => process.env.NODE_ENV === 'test',
  },
);
