import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';

export const STAFF_ASSIGNMENT_INCLUDE = {
  user: { select: { id: true, fullName: true, email: true, role: true, avatarUrl: true } },
  staffTag: { select: { id: true, slug: true, label: true, singular: true, sortOrder: true } },
} as const;

export async function syncCompanyLegacyStaffFields(companyId: string) {
  const assignments = await prisma.companyStaffAssignment.findMany({
    where: { companyId },
    include: { staffTag: { select: { slug: true, singular: true } } },
  });

  const bySlug = new Map<string, string>();
  for (const a of assignments) {
    if (a.staffTag.singular) {
      bySlug.set(a.staffTag.slug, a.userId);
    }
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      assignedSalesmanId: bySlug.get('salesman') ?? null,
      assignedProjectManagerId: bySlug.get('project_manager') ?? null,
    },
  });
}

export async function assertStaffAssignee(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Staff user not found', 404);
  }
  if (user.role === 'client') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Clients cannot be assigned as staff', 400);
  }
  return user;
}

export async function assertStaffTag(staffTagId: string) {
  const tag = await prisma.staffTag.findUnique({ where: { id: staffTagId } });
  if (!tag) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Staff tag not found', 404);
  }
  return tag;
}

export async function validateAssignmentRoleMatch(
  userRole: string,
  tagSlug: string,
): Promise<void> {
  if (tagSlug === 'salesman' && userRole !== 'salesman' && userRole !== 'admin') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Salesman tag requires a user with the salesman role',
      400,
    );
  }
}

export async function assertSingularTagSlot(
  companyId: string,
  staffTagId: string,
  userId: string,
  excludeAssignmentId?: string,
) {
  const tag = await assertStaffTag(staffTagId);
  if (!tag.singular) return tag;

  const existing = await prisma.companyStaffAssignment.findFirst({
    where: {
      companyId,
      staffTagId,
      ...(excludeAssignmentId ? { NOT: { id: excludeAssignmentId } } : {}),
    },
  });
  if (existing && existing.userId !== userId) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `Only one ${tag.label} can be assigned per client`,
      400,
    );
  }
  return tag;
}

export type AssignmentInput = { user_id: string; staff_tag_id: string };

export async function replaceCompanyStaffAssignments(
  companyId: string,
  items: AssignmentInput[],
) {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.user_id}:${item.staff_tag_id}`;
    if (seen.has(key)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Duplicate assignment in request', 400);
    }
    seen.add(key);
  }

  const singularCount = new Map<string, number>();
  for (const item of items) {
    const tag = await assertStaffTag(item.staff_tag_id);
    const user = await assertStaffAssignee(item.user_id);
    await validateAssignmentRoleMatch(user.role, tag.slug);
    if (tag.singular) {
      singularCount.set(tag.id, (singularCount.get(tag.id) ?? 0) + 1);
      if ((singularCount.get(tag.id) ?? 0) > 1) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          `Only one ${tag.label} assignment allowed per client`,
          400,
        );
      }
    }
  }

  // D1 does not support Prisma interactive $transaction callbacks; run sequentially.
  await prisma.companyStaffAssignment.deleteMany({ where: { companyId } });
  const now = new Date();
  for (const item of items) {
    await prisma.companyStaffAssignment.create({
      data: {
        companyId,
        userId: item.user_id,
        staffTagId: item.staff_tag_id,
        updatedAt: now,
      },
    });
  }

  await syncCompanyLegacyStaffFields(companyId);

  return prisma.companyStaffAssignment.findMany({
    where: { companyId },
    include: STAFF_ASSIGNMENT_INCLUDE,
    orderBy: [{ staffTag: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
  });
}
