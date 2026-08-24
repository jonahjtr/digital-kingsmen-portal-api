import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../lib/jwt';
import { AppError, ErrorCodes } from '../lib/errors';
import { error } from '../lib/apiResponse';
import { applyCorsHeaders } from '../lib/cors';
import { getWorkerBindings } from '../lib/workerBindings';

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

function mcpApiKey(): string | undefined {
  return process.env.MCP_API_KEY || getWorkerBindings()?.MCP_API_KEY || undefined;
}

function headerApiKey(req: Request): string | undefined {
  const raw = req.headers['x-api-key'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
  return undefined;
}

/** JWT for the portal, or X-API-Key matching MCP_API_KEY for Hermes. */
export async function authenticateJwtOrMcp(req: Request, res: Response, next: NextFunction) {
  const expected = mcpApiKey();
  const provided = headerApiKey(req);
  if (expected && provided && provided === expected) {
    try {
      const admin = await prisma.user.findFirst({
        where: { role: 'admin', isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!admin) {
        throw new AppError(ErrorCodes.UNAUTHORIZED, 'No admin user available for MCP', 401);
      }
      req.user = admin;
      req.mcpAuth = true;
      return next();
    } catch (err) {
      applyCorsHeaders(req, res);
      if (err instanceof AppError) {
        return error(res, err.code, err.message, err.statusCode);
      }
      return error(res, ErrorCodes.UNAUTHORIZED, 'MCP authentication failed', 401);
    }
  }
  return authenticate(req, res, next);
}
