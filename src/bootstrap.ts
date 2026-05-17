import { applyD1SchemaPatches } from './lib/d1SchemaPatches';
import { initPrisma } from './lib/prisma';
import { initStorage } from './storage';
import type { CloudflareBindings } from './types/cloudflare';

/** Initialize Prisma (D1 or local SQLite) and R2/local storage before loading routes. */
export async function bootstrap(bindings?: Partial<CloudflareBindings>): Promise<void> {
  const onWorkers = Boolean(bindings?.DB);
  if (bindings?.DB) {
    await applyD1SchemaPatches(bindings.DB);
  }
  initPrisma(bindings?.DB);
  initStorage(bindings?.R2, { useMemory: onWorkers && !bindings?.R2 });
}
