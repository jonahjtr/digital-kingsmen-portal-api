import express from 'express';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { corsOrigins } from './config/env';
import apiRoutes from './routes';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/', (_req, res) => {
    res.json({ message: 'Digital Kingsmen Portal API', docs: '/api/docs' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  try {
    const openApiPath = path.join(process.cwd(), 'openapi.yaml');
    const swaggerDocument = YAML.load(openApiPath);
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  } catch {
    // OpenAPI file optional during early setup
  }

  app.use('/api', apiRoutes);
  app.use(errorHandler);

  return app;
}
