import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  STORAGE_DRIVER: z.enum(['local', 'r2', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  NUDGE_COOLDOWN_MINUTES: z.coerce.number().default(240),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

export const env = loadEnv();

export const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
