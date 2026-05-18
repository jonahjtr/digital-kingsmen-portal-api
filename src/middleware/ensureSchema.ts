import type { Request, Response, NextFunction } from 'express';
import { applyD1SchemaPatches } from '../lib/d1SchemaPatches';
import { getD1Binding } from '../lib/prisma';

let schemaReady: Promise<void> | null = null;

/** Runs D1 migrations once per isolate — must not run in worker global scope. */
export function ensureSchemaMiddleware(req: Request, res: Response, next: NextFunction) {
  const db = getD1Binding();
  if (!db) {
    next();
    return;
  }

  if (!schemaReady) {
    schemaReady = applyD1SchemaPatches(db);
  }

  schemaReady.then(() => next()).catch(next);
}
