import type { Request, Response, NextFunction } from 'express';
import { applyD1SchemaPatches } from '../lib/d1SchemaPatches';
import { getD1Binding } from '../lib/prisma';

const SCHEMA_PATCH_TIMEOUT_MS = 5_000;

let schemaReady: Promise<void> | null = null;

function startSchemaPatches(db: D1Database): Promise<void> {
  return Promise.race([
    applyD1SchemaPatches(db),
    new Promise<void>((_, reject) => {
      setTimeout(
        () => reject(new Error(`D1 schema patches timed out after ${SCHEMA_PATCH_TIMEOUT_MS}ms`)),
        SCHEMA_PATCH_TIMEOUT_MS,
      );
    }),
  ]).catch((err) => {
    schemaReady = null;
    throw err;
  });
}

/** Runs D1 migrations once per isolate — must not run in worker global scope. */
export function ensureSchemaMiddleware(req: Request, res: Response, next: NextFunction) {
  const db = getD1Binding();
  if (!db) {
    next();
    return;
  }

  if (!schemaReady) {
    schemaReady = startSchemaPatches(db);
  }

  void schemaReady.then(() => next(), next);
}
