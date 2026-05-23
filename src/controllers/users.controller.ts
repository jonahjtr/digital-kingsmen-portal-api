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
import type { Prisma } from '@prisma/client';

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

function buildUserListWhere(
  search?: string,
  roleFilter?: string,
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (search) {
    where.OR = [{ email: textContains(search) }, { fullName: textContains(search) }];
  }
  if (roleFilter === 'staff') {
    where.role = { not: UserRole.client };
  } else if (roleFilter && Object.values(UserRole).includes(roleFilter as UserRole)) {
    where.role = roleFilter as UserRole;
  }
  return where;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const { page, limit, skip, search, sortBy, sortOrder } = parsePagination(req.query);
    const roleFilter = req.query.role ? String(req.query.role) : undefined;
    const where = buildUserListWhere(search, roleFilter);
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

export async function listContacts(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const { page, limit, skip, search, sortBy, sortOrder } = parsePagination(req.query);
    const where = buildUserListWhere(search, UserRole.client);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          companyUsers: {
            orderBy: { company: { name: 'asc' } },
            select: {
              id: true,
              companyId: true,
              relationshipType: true,
              createdAt: true,
              company: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);
    const data = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      companies: u.companyUsers.map((cu) => ({
        id: cu.id,
        companyId: cu.companyId,
        companyName: cu.company.name,
        relationshipType: cu.relationshipType,
        createdAt: cu.createdAt,
      })),
    }));
    return success(res, data, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function listContactCompanies(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const userId = getParam(req, 'id');
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
    if (user.role !== UserRole.client) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'User is not a client contact', 400);
    }
    const memberships = await prisma.companyUser.findMany({
      where: { userId },
      orderBy: { company: { name: 'asc' } },
      select: {
        id: true,
        companyId: true,
        relationshipType: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    const data = memberships.map((m) => ({
      id: m.id,
      companyId: m.companyId,
      companyName: m.company.name,
      relationshipType: m.relationshipType,
      createdAt: m.createdAt,
    }));
    return success(res, data);
  } catch (err) {
    next(err);
  }
}

export async function addContactCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const userId = getParam(req, 'id');
    const { company_id: companyId, relationship_type: relationshipType } = req.body as {
      company_id: string;
      relationship_type: string;
    };
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
    if (user.role !== UserRole.client) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Only client users can be linked to companies', 400);
    }
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);

    const membership = await prisma.companyUser.create({
      data: { userId, companyId, relationshipType },
      select: {
        id: true,
        companyId: true,
        relationshipType: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    return created(res, {
      id: membership.id,
      companyId: membership.companyId,
      companyName: membership.company.name,
      relationshipType: membership.relationshipType,
      createdAt: membership.createdAt,
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return next(new AppError(ErrorCodes.CONFLICT, 'This user is already a contact for that company', 409));
    }
    next(err);
  }
}

export async function updateContactCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const userId = getParam(req, 'id');
    const membershipId = getParam(req, 'membershipId');
    const { relationship_type: relationshipType } = req.body as { relationship_type: string };

    const membership = await prisma.companyUser.findFirst({
      where: { id: membershipId, userId },
    });
    if (!membership) throw new AppError(ErrorCodes.NOT_FOUND, 'Company membership not found', 404);

    const updated = await prisma.companyUser.update({
      where: { id: membershipId },
      data: { relationshipType },
      select: {
        id: true,
        companyId: true,
        relationshipType: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    return success(res, {
      id: updated.id,
      companyId: updated.companyId,
      companyName: updated.company.name,
      relationshipType: updated.relationshipType,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function removeContactCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const userId = getParam(req, 'id');
    const membershipId = getParam(req, 'membershipId');
    const membership = await prisma.companyUser.findFirst({
      where: { id: membershipId, userId },
    });
    if (!membership) throw new AppError(ErrorCodes.NOT_FOUND, 'Company membership not found', 404);
    await prisma.companyUser.delete({ where: { id: membershipId } });
    return success(res, { deleted: true });
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
