import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { signToken, getExpiresInSeconds } from '../lib/jwt';
import { sanitizeUser } from '../lib/sanitize';
import { AppError, ErrorCodes } from '../lib/errors';
import { success } from '../lib/apiResponse';

const VIEW_AS_TTL = '1h';

/**
 * POST /api/auth/view-as/:userId — admin gets a 1h token that acts exactly as that user.
 * Rules: admin only, can't nest, can't view as another admin or an inactive user.
 * ponytail: audit goes to Workers logs (console). Upgrade path: an audit table if we need history in-app.
 */
export async function start(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.impersonator) throw new AppError(ErrorCodes.FORBIDDEN, 'Exit the current view-as first', 403);
    if (req.user!.role !== 'admin') throw new AppError(ErrorCodes.FORBIDDEN, 'Admins only', 403);
    const target = await prisma.user.findUnique({ where: { id: String(req.params.userId) } });
    if (!target || !target.isActive) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
    if (target.role === 'admin') throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot view as another admin', 403);
    const token = signToken({ sub: target.id, email: target.email, role: target.role, imp: req.user!.id }, VIEW_AS_TTL);
    console.info(JSON.stringify({ audit: 'view_as_start', admin: req.user!.email, target: target.email, at: new Date().toISOString() }));
    return success(res, { accessToken: token, expiresIn: getExpiresInSeconds(VIEW_AS_TTL), user: sanitizeUser(target) });
  } catch (err) {
    next(err);
  }
}

/** Blocks account-changing actions while viewing as someone (password, email, deleting things that are theirs). */
export function blockWhileViewingAs(req: Request, _res: Response, next: NextFunction) {
  if (req.impersonator) return next(new AppError(ErrorCodes.FORBIDDEN, 'Not allowed while viewing as another user', 403));
  next();
}
