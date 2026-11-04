import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { generateToken } from './auth';

/**
 * Admin-only management of personal MCP tokens.
 * Raw token is returned exactly once, on create. Only the SHA-256 hash is stored.
 * Deliberately NOT reachable with an MCP token or the legacy X-API-Key (JWT admin only),
 * so a leaked MCP token can never mint more tokens.
 */
const router = Router();
router.use(authenticate, requireRole('admin'));

const createSchema = z
  .object({
    user_id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(['read', 'write'])).min(1).default(['read']),
    expires_in_days: z.number().int().min(1).max(365).default(90),
  })
  .strict();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body ?? {});
    const user = await prisma.user.findFirst({ where: { id: body.user_id, isActive: true } });
    if (!user || user.role === 'client') {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'MCP tokens can only be issued to active DK staff', 400);
    }
    const scopes = [...new Set(['read', ...body.scopes])].join(',');
    const t = generateToken();
    const row = await prisma.mcpToken.create({
      data: {
        userId: user.id,
        name: body.name,
        tokenHash: t.hash,
        prefix: t.prefix,
        scopes,
        expiresAt: new Date(Date.now() + body.expires_in_days * 86_400_000),
        createdBy: req.user!.id,
      },
      select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true },
    });
    res.setHeader('Cache-Control', 'no-store');
    return created(res, { ...row, user: { id: user.id, fullName: user.fullName, role: user.role }, token: t.raw });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(ErrorCodes.VALIDATION_ERROR, err.issues[0]?.message ?? 'Invalid body', 400));
    next(err);
  }
});

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.mcpToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });
    return success(res, rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.mcpAuditLog.findMany({
      where: { tokenId: String(req.params.id) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return success(res, rows);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await prisma.mcpToken.updateMany({
      where: { id: String(req.params.id), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw new AppError(ErrorCodes.NOT_FOUND, 'Token not found or already revoked', 404);
    return success(res, { revoked: true });
  } catch (err) {
    next(err);
  }
});

export default router;
