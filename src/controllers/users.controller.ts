import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { sanitizeUser } from '../lib/sanitize';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertNotClient, assertRole } from '../permissions/access';
import { STAFF_ASSIGNMENT_INCLUDE } from '../services/companyStaffAssignments';
import { textContains } from '../lib/searchFilter';
import { UserRole } from '@prisma/client';

async function assertCanDeactivateUser(actorId: string, targetId: string): Promise<void> {
  if (actorId === targetId) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'You cannot deactivate your own account', 403);
  }
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  if (target.role === UserRole.admin && target.isActive) {
    const activeAdmins = await prisma.user.count({
      where: { role: UserRole.admin, isActive: true },
    });
    if (activeAdmins <= 1) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot deactivate the last active admin', 403);
    }
  }
}

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

export async function listStaff(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    if (req.user!.role === 'salesman') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Not allowed to list staff users', 403);
    }
    const roleFilter = req.query.role as string | undefined;
    const where: Record<string, unknown> = {
      isActive: true,
      role: { not: UserRole.client },
    };
    if (roleFilter && ['admin', 'salesman', 'employee'].includes(roleFilter)) {
      where.role = roleFilter as UserRole;
    }
    const users = await prisma.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        avatarUrl: true,
      },
    });
    return success(res, users);
  } catch (err) {
    next(err);
  }
}

export async function listStaffAssignments(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const userId = getParam(req, 'id');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);

    const assignments = await prisma.companyStaffAssignment.findMany({
      where: { userId },
      include: {
        ...STAFF_ASSIGNMENT_INCLUDE,
        company: { select: { id: true, name: true } },
      },
      orderBy: [{ company: { name: 'asc' } }, { staffTag: { sortOrder: 'asc' } }],
    });
    return success(res, assignments);
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
    if (is_active !== undefined && req.user!.role === 'admin') {
      if (is_active === false) {
        await assertCanDeactivateUser(req.user!.id, getParam(req, 'id'));
      }
      data.isActive = is_active;
    }
    const user = await prisma.user.update({ where: { id: getParam(req, 'id') }, data });
    return success(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    await assertCanDeactivateUser(req.user!.id, getParam(req, 'id'));
    const user = await prisma.user.update({
      where: { id: getParam(req, 'id') },
      data: { isActive: false },
    });
    return success(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
}
