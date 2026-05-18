import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

export let prisma: PrismaClient;

let d1Binding: D1Database | undefined;

type D1HttpConfig = {
  CLOUDFLARE_D1_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_DATABASE_ID: string;
};

export function isD1WorkersMode(): boolean {
  return Boolean(d1Binding);
}

export function getD1Binding(): D1Database | undefined {
  return d1Binding;
}

export function initPrisma(d1?: D1Database | D1HttpConfig): PrismaClient {
  if (prisma) return prisma;

  if (d1 && typeof d1 === 'object' && 'prepare' in d1) {
    d1Binding = d1 as D1Database;
    prisma = new PrismaClient({
      adapter: new PrismaD1(d1Binding),
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  } else {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }

  return prisma;
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    initPrisma();
  }
  return prisma;
}
