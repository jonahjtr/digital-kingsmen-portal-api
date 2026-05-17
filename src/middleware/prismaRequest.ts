import type { Request, Response, NextFunction } from 'express';
import { createRequestPrismaClient, isD1WorkersMode, runWithRequestPrisma } from '../lib/prisma';

/**
 * On Cloudflare Workers, a shared PrismaClient causes DataLoader promises to leak
 * across concurrent Express requests and hang. Use one client per request instead.
 */
export function prismaRequestMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isD1WorkersMode()) {
    next();
    return;
  }

  const client = createRequestPrismaClient();
  if (!client) {
    next();
    return;
  }

  runWithRequestPrisma(client, () => {
    res.on('finish', () => {
      void client.$disconnect().catch(() => {});
    });
    res.on('close', () => {
      void client.$disconnect().catch(() => {});
    });
    next();
  });
}
