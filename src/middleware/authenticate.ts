import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../lib/jwt';
import { AppError, ErrorCodes } from '../lib/errors';
import { error } from '../lib/apiResponse';
import { applyCorsHeaders } from '../lib/cors';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
    }
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid or inactive user', 401);
    }
    req.user = user;
    next();
  } catch (err) {
    applyCorsHeaders(req, res);
    if (err instanceof AppError) {
      return error(res, err.code, err.message, err.statusCode);
    }
    return error(res, ErrorCodes.UNAUTHORIZED, 'Invalid token', 401);
  }
}

export function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
}
