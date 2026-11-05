import { Prisma, User, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';

export async function getClientCompanyIds(userId: string): Promise<string[]> {
  const links = await prisma.companyUser.findMany({
    where: { userId },
    select: { companyId: true },
  });
  return links.map((l) => l.companyId);
}

export async function companyWhereForUser(user: User): Promise<Prisma.CompanyWhereInput> {
  if (user.role === 'admin') return {};
  if (user.role === 'client') {
    const companyIds = await getClientCompanyIds(user.id);
    return { id: { in: companyIds } };
  }
  // Sales sees every client (they sell across the book). Money is scoped separately: moneyScope.ts.
  if (user.role === 'salesman') return {};
  if (user.role === 'employee') {
    return {
      OR: [
        { assignedProjectManagerId: user.id },
        { staffAssignments: { some: { userId: user.id } } },
        { tasks: { some: { assignedTo: user.id } } },
        {
          projects: {
            some: {
              OR: [
                { projectManagerId: user.id },
                { teamMembers: { some: { userId: user.id } } },
                { tasks: { some: { assignedTo: user.id } } },
              ],
            },
          },
        },
      ],
    };
  }
  return { id: 'never' };
}

export async function projectWhereForUser(user: User): Promise<Prisma.ProjectWhereInput> {
  if (user.role === 'admin') return {};
  if (user.role === 'client') {
    const companyIds = await getClientCompanyIds(user.id);
    return { companyId: { in: companyIds } };
  }
  if (user.role === 'salesman') return {};
  if (user.role === 'employee') {
    return {
      OR: [
        { projectManagerId: user.id },
        { teamMembers: { some: { userId: user.id } } },
        { tasks: { some: { assignedTo: user.id } } },
      ],
    };
  }
  return { id: 'never' };
}

/** Excludes archived tasks from boards and default listings. */
export const activeTaskWhere: Prisma.TaskWhereInput = { archivedAt: null };

/** Tasks with no company and no project — visible to all staff. */
export const internalTaskWhere: Prisma.TaskWhereInput = {
  companyId: null,
  projectId: null,
};

export async function taskWhereForUser(user: User): Promise<Prisma.TaskWhereInput> {
  const projectWhere = await projectWhereForUser(user);
  const companyWhere = await companyWhereForUser(user);

  if (user.role === 'admin' || user.role === 'salesman') return {};
  if (user.role === 'client') {
    return {
      AND: [
        { clientVisible: true },
        {
          OR: [
            { project: projectWhere },
            { AND: [{ projectId: null }, { company: companyWhere }] },
          ],
        },
      ],
    };
  }
  if (user.role === 'employee') {
    return {
      OR: [
        { assignedTo: user.id },
        { project: projectWhere },
        { AND: [{ projectId: null }, { company: companyWhere }] },
        internalTaskWhere,
      ],
    };
  }
  return {
    OR: [
      { project: projectWhere },
      { AND: [{ projectId: null }, { company: companyWhere }] },
      internalTaskWhere,
    ],
  };
}

export function updateVisibilityFilter(user: User): Prisma.ProjectUpdateWhereInput {
  if (user.role === 'client') {
    return { visibility: 'client_visible' };
  }
  return {};
}

export function messageInternalFilter(user: User): Prisma.MessageWhereInput {
  if (user.role === 'client') {
    return { internalOnly: false };
  }
  return {};
}

export function taskCommentInternalFilter(user: User): Prisma.TaskCommentWhereInput {
  if (user.role === 'client') {
    return { internalOnly: false };
  }
  return {};
}
