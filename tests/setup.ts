import dotenv from 'dotenv';
import path from 'path';
import { initPrisma } from '../src/lib/prisma';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  process.env.JWT_SECRET = 'test-jwt-secret-min-16-chars';
}

if (!process.env.DATABASE_URL?.startsWith('file:')) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}

initPrisma();
