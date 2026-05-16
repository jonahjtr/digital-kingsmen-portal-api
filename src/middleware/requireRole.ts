import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { error } from '../lib/apiResponse';
import { ErrorCodes } from '../lib/errors';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return error(res, ErrorCodes.UNAUTHORIZED, 'Authentication required', 401);
    }
    if (!roles.includes(req.user.role)) {
      return error(res, ErrorCodes.FORBIDDEN, 'Insufficient permissions', 403);
    }
    next();
  };
}
