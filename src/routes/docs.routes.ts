import { Router } from 'express';

const router = Router();

/** Optional Swagger UI — only mounted in Node dev (ENABLE_SWAGGER=true). */
export async function mountDocs(app: import('express').Application) {
  const path = await import('path');
  const YAML = await import('yamljs');
  const swaggerUi = await import('swagger-ui-express');
  const openApiPath = path.join(process.cwd(), 'openapi.yaml');
  const swaggerDocument = YAML.load(openApiPath);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

export default router;
