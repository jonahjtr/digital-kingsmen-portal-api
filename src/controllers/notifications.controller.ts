import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { userId: req.user!.id };
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
    ]);
    return success(res, notifications, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: getParam(req, 'id'), userId: req.user!.id },
    });
    if (!notification) throw new AppError(ErrorCodes.NOT_FOUND, 'Notification not found', 404);
    const updated = await prisma.notification.update({
      where: { id: getParam(req, 'id') },
      data: { readAt: new Date() },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return success(res, { updated: true });
  } catch (err) {
    next(err);
  }
}
