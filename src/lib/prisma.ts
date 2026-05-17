import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

export let prisma: PrismaClient;

type D1HttpConfig = {
  CLOUDFLARE_D1_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_DATABASE_ID: string;
};

export function initPrisma(d1?: D1Database | D1HttpConfig): PrismaClient {
  if (prisma) return prisma;

  if (d1) {
    const adapter = new PrismaD1(d1);
    prisma = new PrismaClient({ adapter });
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
