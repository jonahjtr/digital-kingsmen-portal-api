import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

const prismaStore = new AsyncLocalStorage<PrismaClient>();

/** Set when running on Cloudflare Workers with a D1 binding. */
let d1Binding: D1Database | undefined;

/** Node/SQLite singleton for tests and `npm run dev:node`. */
let nodePrisma: PrismaClient | undefined;

function createD1Client(db: D1Database): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaD1(db),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function activeClient(): PrismaClient {
  const scoped = prismaStore.getStore();
  if (scoped) return scoped;
  if (nodePrisma) return nodePrisma;
  throw new Error('Prisma is not initialized for this request');
}

/** Proxy so existing `import { prisma }` works with per-request D1 clients on Workers. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = activeClient();
    const value = client[prop as keyof PrismaClient];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});

type D1HttpConfig = {
  CLOUDFLARE_D1_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_DATABASE_ID: string;
};

export function isD1WorkersMode(): boolean {
  return Boolean(d1Binding);
}

export function initPrisma(d1?: D1Database | D1HttpConfig): PrismaClient {
  if (d1 && typeof d1 === 'object' && 'prepare' in d1) {
    d1Binding = d1 as D1Database;
    // One client for module-level bootstrap (schema patches, etc.) only.
    if (!nodePrisma) {
      nodePrisma = createD1Client(d1Binding);
    }
    return nodePrisma;
  }

  if (!nodePrisma) {
    nodePrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return nodePrisma;
}

export function getPrisma(): PrismaClient {
  return prismaStore.getStore() ?? nodePrisma ?? initPrisma();
}

/** Isolates Prisma to the current HTTP request on Workers (avoids DataLoader cross-request hangs). */
export function runWithRequestPrisma<T>(client: PrismaClient, fn: () => T): T {
  return prismaStore.run(client, fn);
}

export function getD1Binding(): D1Database | undefined {
  return d1Binding;
}

export function createRequestPrismaClient(): PrismaClient | null {
  if (!d1Binding) return null;
  return createD1Client(d1Binding);
}
