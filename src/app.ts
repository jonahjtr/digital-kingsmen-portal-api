import express from 'express';
import cors from 'cors';
import { isAllowedOrigin } from './lib/cors';
import apiRoutes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { workersBodyParser } from './middleware/bodyParser';
import { ensureSchemaMiddleware } from './middleware/ensureSchema';
import { corsResponseMiddleware } from './middleware/corsResponse';
import { prismaRequestMiddleware } from './middleware/prismaRequest';

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
  app.use(corsResponseMiddleware);
  app.use(workersBodyParser());
  app.use(ensureSchemaMiddleware);
  app.use(prismaRequestMiddleware);

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
