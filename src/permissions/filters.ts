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
  if (user.role === 'salesman') {
    return {
      OR: [
        { assignedSalesmanId: user.id },
        { projects: { some: { assignedSalesmanId: user.id } } },
      ],
    };
  }
  if (user.role === 'employee') {
    return {
      projects: {
        some: {
          OR: [
            { projectManagerId: user.id },
            { teamMembers: { some: { userId: user.id } } },
            { tasks: { some: { assignedTo: user.id } } },
          ],
        },
      },
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
  if (user.role === 'salesman') {
    return {
      OR: [
        { assignedSalesmanId: user.id },
        { company: { assignedSalesmanId: user.id } },
      ],
    };
  }
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

export async function taskWhereForUser(user: User): Promise<Prisma.TaskWhereInput> {
  const projectWhere = await projectWhereForUser(user);
  if (user.role === 'admin') return {};
  if (user.role === 'client') {
    return { AND: [{ project: projectWhere }, { clientVisible: true }] };
  }
  if (user.role === 'employee') {
    return {
      OR: [
        { assignedTo: user.id },
        { project: projectWhere },
      ],
    };
  }
  return { project: projectWhere };
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
