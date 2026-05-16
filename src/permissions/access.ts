import { User, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';
import { getClientCompanyIds, projectWhereForUser } from './filters';

export function canSeeInternal(user: User): boolean {
  return user.role !== 'client';
}

export function isAdmin(user: User): boolean {
  return user.role === 'admin';
}

export async function assertCanAccessCompany(user: User, companyId: string): Promise<void> {
  if (user.role === 'admin') return;
  const where = await import('./filters').then((m) => m.companyWhereForUser(user));
  const company = await prisma.company.findFirst({
    where: { AND: [{ id: companyId }, where] },
  });
  if (!company) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied to this company', 403);
  }
}

export async function assertCanAccessProject(user: User, projectId: string): Promise<void> {
  if (user.role === 'admin') return;
  const where = await projectWhereForUser(user);
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, where] },
  });
  if (!project) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied to this project', 403);
  }
}

export async function getProjectIfAccessible(user: User, projectId: string) {
  const where = await projectWhereForUser(user);
  const project = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, where] },
    include: {
      company: true,
      services: { include: { steps: { orderBy: { sortOrder: 'asc' } } } },
      teamMembers: { include: { user: { select: { id: true, fullName: true, email: true, role: true } } } },
    },
  });
  if (!project) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Project not found', 404);
  }
  return project;
}

export function assertRole(user: User, ...roles: UserRole[]): void {
  if (!roles.includes(user.role)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Insufficient permissions', 403);
  }
}

export function assertNotClient(user: User): void {
  if (user.role === 'client') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Clients cannot perform this action', 403);
  }
}

export function stripClientForbiddenFields<T extends Record<string, unknown>>(
  body: T,
  user: User,
  forbidden: string[],
): T {
  if (user.role !== 'client') return body;
  const copy = { ...body };
  for (const key of forbidden) {
    delete copy[key];
  }
  return copy;
}

export async function assertClientCompanyAccess(user: User, companyId: string): Promise<void> {
  if (user.role !== 'client') return;
  const ids = await getClientCompanyIds(user.id);
  if (!ids.includes(companyId)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  }
}

export async function canManageUsers(user: User): Promise<boolean> {
  return user.role === 'admin';
}

export async function assertCanModifyTask(user: User, taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError(ErrorCodes.NOT_FOUND, 'Task not found', 404);

  if (user.role === 'admin') return;
  if (user.role === 'employee' && task.assignedTo === user.id) return;
  if (user.role === 'employee' || user.role === 'salesman') {
    await assertCanAccessProject(user, task.projectId);
    if (user.role === 'employee' && task.assignedTo !== user.id) {
      const project = await prisma.project.findUnique({ where: { id: task.projectId } });
      if (project?.projectManagerId !== user.id) {
        throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot modify this task', 403);
      }
    }
    return;
  }
  throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot modify this task', 403);
}
