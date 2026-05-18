import type { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

let d1Binding: D1Database | undefined;
let fallbackPrisma: PrismaClient | undefined;
let requestStorage: AsyncLocalStorage<PrismaClient> | null | undefined;

type D1HttpConfig = {
  CLOUDFLARE_D1_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_DATABASE_ID: string;
};

function createD1Client(db: D1Database): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaD1(db),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function getRequestStorage(): AsyncLocalStorage<PrismaClient> | null {
  if (!d1Binding) return null;
  if (requestStorage === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AsyncLocalStorage: ALS } = require('node:async_hooks');
      requestStorage = new ALS();
    } catch {
      requestStorage = null;
    }
  }
  return requestStorage;
}

function activeClient(): PrismaClient {
  const scoped = getRequestStorage()?.getStore();
  if (scoped) return scoped;
  if (!fallbackPrisma) {
    throw new Error('Prisma is not initialized for this request');
  }
  return fallbackPrisma;
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

export function isD1WorkersMode(): boolean {
  return Boolean(d1Binding);
}

export function getD1Binding(): D1Database | undefined {
  return d1Binding;
}

export function initPrisma(d1?: D1Database | D1HttpConfig): PrismaClient {
  if (d1 && typeof d1 === 'object' && 'prepare' in d1) {
    d1Binding = d1 as D1Database;
    if (!fallbackPrisma) {
      fallbackPrisma = createD1Client(d1Binding);
    }
    return fallbackPrisma;
  }

  if (!fallbackPrisma) {
    fallbackPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return fallbackPrisma;
}

export function getPrisma(): PrismaClient {
  return activeClient();
}

export function createRequestPrismaClient(): PrismaClient | null {
  if (!d1Binding) return null;
  return createD1Client(d1Binding);
}

export function runWithRequestPrisma<T>(client: PrismaClient, fn: () => T): T {
  const storage = getRequestStorage();
  if (!storage) return fn();
  return storage.run(client, fn);
}
