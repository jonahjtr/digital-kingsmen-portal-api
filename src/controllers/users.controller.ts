import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { sanitizeUser } from '../lib/sanitize';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertRole } from '../permissions/access';
import { textContains } from '../lib/searchFilter';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const { page, limit, skip, search, sortBy, sortOrder } = parsePagination(req.query);
    const where = search
      ? {
          OR: [
            { email: textContains(search) },
            { fullName: textContains(search) },
          ],
        }
      : {};
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true, email: true, fullName: true, phone: true, role: true,
          avatarUrl: true, isActive: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    return success(res, users, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const isSelf = getParam(req, 'id') === req.user!.id;
    if (!isSelf) assertRole(req.user!, 'admin');
    const user = await prisma.user.findUnique({ where: { id: getParam(req, 'id') } });
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
    return success(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const { email, password, full_name, phone, role, avatar_url } = req.body;
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        fullName: full_name,
        phone,
        role,
        avatarUrl: avatar_url,
      },
    });
    return created(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const isSelf = getParam(req, 'id') === req.user!.id;
    if (!isSelf) assertRole(req.user!, 'admin');
    const { email, password, full_name, phone, role, avatar_url, is_active } = req.body;
    const data: Record<string, unknown> = {};
    if (email) data.email = email.toLowerCase();
    if (password) data.passwordHash = await hashPassword(password);
    if (full_name) data.fullName = full_name;
    if (phone !== undefined) data.phone = phone;
    if (role && req.user!.role === 'admin') data.role = role;
    if (avatar_url !== undefined) data.avatarUrl = avatar_url;
    if (is_active !== undefined && req.user!.role === 'admin') data.isActive = is_active;
    const user = await prisma.user.update({ where: { id: getParam(req, 'id') }, data });
    return success(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const user = await prisma.user.update({
      where: { id: getParam(req, 'id') },
      data: { isActive: false },
    });
    return success(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
}
