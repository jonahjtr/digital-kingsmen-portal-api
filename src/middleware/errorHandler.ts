import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '../lib/errors';
import { error } from '../lib/apiResponse';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return error(res, err.code, err.message, err.statusCode);
  }
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return error(res, ErrorCodes.VALIDATION_ERROR, message, 400);
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error(err);
    return error(
      res,
      ErrorCodes.INTERNAL_ERROR,
      'Database connection failed. Check DATABASE_URL in .env and that PostgreSQL is running.',
      503,
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    console.error('Prisma error:', err.code, err.message);
    if (err.code === 'P2022') {
      return error(
        res,
        ErrorCodes.INTERNAL_ERROR,
        'Database schema is out of date. Run migrations (npm run cf:migrate:remote) and redeploy the API.',
        503,
      );
    }
    if (process.env.NODE_ENV !== 'production') {
      return error(res, ErrorCodes.INTERNAL_ERROR, err.message, 500);
    }
  }
  console.error(err);
  return error(res, ErrorCodes.INTERNAL_ERROR, 'An unexpected error occurred', 500);
}
