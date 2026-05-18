import { initPrisma } from './lib/prisma';
import { initStorage } from './storage';
import type { CloudflareBindings } from './types/cloudflare';

/** Initialize Prisma (D1 or local SQLite) and R2/local storage. Sync-only — no D1 I/O here (Workers global scope). */
export function bootstrap(bindings?: Partial<CloudflareBindings>): void {
  const onWorkers = Boolean(bindings?.DB);
  initPrisma(bindings?.DB);
  initStorage(bindings?.R2, { useMemory: onWorkers && !bindings?.R2 });
}
