import type { Request, Response, NextFunction } from 'express';
import {
  createRequestPrismaClient,
  isD1WorkersMode,
  runWithRequestPrisma,
} from '../lib/prisma';

/** One Prisma client per HTTP request on Workers — avoids D1 DataLoader cross-request hangs. */
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

  const disconnect = () => {
    void client.$disconnect().catch(() => {});
  };

  runWithRequestPrisma(client, () => {
    res.on('finish', disconnect);
    res.on('close', disconnect);
    next();
  });
}
