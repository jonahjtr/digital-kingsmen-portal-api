import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertRole } from '../permissions/access';
import { getClientCompanyIds } from '../permissions/filters';

async function announcementWhereForUser(user: { id: string; role: UserRole }) {
  if (user.role === 'admin') return {};
  if (user.role === 'client') {
    const companyIds = await getClientCompanyIds(user.id);
    return {
      OR: [
        { audience: 'everyone' as const },
        { audience: 'all_clients' as const },
        { audience: 'specific_client' as const, companyId: { in: companyIds } },
      ],
    };
  }
  if (user.role === 'salesman') {
    return {
      OR: [
        { audience: 'everyone' as const },
        { audience: 'salesmen_only' as const },
        { audience: 'internal_team' as const },
      ],
    };
  }
  return {
    OR: [
      { audience: 'everyone' as const },
      { audience: 'internal_team' as const },
    ],
  };
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = await announcementWhereForUser(req.user!);
    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.announcement.count({ where }),
    ]);
    return success(res, announcements, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const body = req.body;
    const announcement = await prisma.announcement.create({
      data: {
        title: body.title,
        message: body.message,
        audience: body.audience,
        companyId: body.company_id,
        createdBy: req.user!.id,
      },
    });
    return created(res, announcement);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const body = req.body;
    const announcement = await prisma.announcement.update({
      where: { id: getParam(req, 'id') },
      data: {
        title: body.title,
        message: body.message,
        audience: body.audience,
        companyId: body.company_id,
      },
    });
    return success(res, announcement);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    await prisma.announcement.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
