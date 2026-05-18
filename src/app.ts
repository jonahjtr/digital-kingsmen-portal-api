import express from 'express';
import cors from 'cors';
import { corsOrigins } from './config/env';
import apiRoutes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { workersBodyParser } from './middleware/bodyParser';
import { ensureSchemaMiddleware } from './middleware/ensureSchema';

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (corsOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname.endsWith('.lovable.app') ||
      hostname.endsWith('.lovableproject.com') ||
      hostname.endsWith('.lovable.dev') ||
      hostname.endsWith('.pages.dev') ||
      hostname.endsWith('.workers.dev')
    );
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, origin ?? true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    }),
  );
  app.use(workersBodyParser());
  app.use(ensureSchemaMiddleware);

  app.get('/', (_req, res) => {
    res.json({ message: 'Digital Kingsmen Portal API', docs: '/api/docs' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', apiRoutes);
  app.use(errorHandler);

  return app;
}
