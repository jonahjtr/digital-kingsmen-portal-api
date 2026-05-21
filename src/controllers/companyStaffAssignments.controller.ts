import { Request, Response, NextFunction } from 'express';
import type { User } from '@prisma/client';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  assertCanAccessCompany,
  assertNotClient,
  isAdmin,
} from '../permissions/access';
import {
  assertSingularTagSlot,
  assertStaffAssignee,
  assertStaffTag,
  replaceCompanyStaffAssignments,
  STAFF_ASSIGNMENT_INCLUDE,
  syncCompanyLegacyStaffFields,
  validateAssignmentRoleMatch,
} from '../services/companyStaffAssignments';

function assertCanMutateStaffAssignments(user: User) {
  if (!isAdmin(user) && user.role !== 'employee') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Not allowed to manage staff assignments', 403);
  }
}

function companyIdFromReq(req: Request) {
  return getParam(req, 'companyId');
}

export async function listForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyId = companyIdFromReq(req);
    await assertCanAccessCompany(req.user!, companyId);

    const assignments = await prisma.companyStaffAssignment.findMany({
      where: { companyId },
      include: STAFF_ASSIGNMENT_INCLUDE,
      orderBy: [{ staffTag: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
    });
    return success(res, assignments);
  } catch (err) {
    next(err);
  }
}

export async function replaceForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const companyId = companyIdFromReq(req);
    await assertCanAccessCompany(req.user!, companyId);
    assertNotClient(req.user!);
    assertCanMutateStaffAssignments(req.user!);

    const assignments = await replaceCompanyStaffAssignments(
      companyId,
      req.body.assignments,
    );
    return success(res, assignments);
  } catch (err) {
    next(err);
  }
}

export async function createForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const companyId = companyIdFromReq(req);
    await assertCanAccessCompany(req.user!, companyId);
    assertNotClient(req.user!);
    assertCanMutateStaffAssignments(req.user!);

    const { user_id: userId, staff_tag_id: staffTagId } = req.body;
    const user = await assertStaffAssignee(userId);
    const tag = await assertSingularTagSlot(companyId, staffTagId, userId);
    await validateAssignmentRoleMatch(user.role, tag.slug);

    const existing = await prisma.companyStaffAssignment.findUnique({
      where: {
        companyId_userId_staffTagId: { companyId, userId, staffTagId },
      },
    });
    if (existing) {
      return success(res, await prisma.companyStaffAssignment.findUniqueOrThrow({
        where: { id: existing.id },
        include: STAFF_ASSIGNMENT_INCLUDE,
      }));
    }

    const assignment = await prisma.companyStaffAssignment.create({
      data: { companyId, userId, staffTagId },
      include: STAFF_ASSIGNMENT_INCLUDE,
    });
    await syncCompanyLegacyStaffFields(companyId);
    return created(res, assignment);
  } catch (err) {
    next(err);
  }
}

export async function removeFromCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const companyId = companyIdFromReq(req);
    const assignmentId = getParam(req, 'assignmentId');
    await assertCanAccessCompany(req.user!, companyId);
    assertNotClient(req.user!);
    assertCanMutateStaffAssignments(req.user!);

    const existing = await prisma.companyStaffAssignment.findFirst({
      where: { id: assignmentId, companyId },
    });
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Assignment not found', 404);
    }

    await prisma.companyStaffAssignment.delete({ where: { id: assignmentId } });
    await syncCompanyLegacyStaffFields(companyId);
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
