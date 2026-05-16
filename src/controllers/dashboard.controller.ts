import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { projectWhereForUser, getClientCompanyIds, updateVisibilityFilter } from '../permissions/filters';

export async function admin(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Admin dashboard only', 403);
    }
    const now = new Date();
    const [
      activeProjects,
      projectsByStatus,
      overdueTasks,
      waitingOnClient,
      recentMessages,
      recentNudges,
      upcomingDeadlines,
      recentApprovals,
      recentFiles,
    ] = await Promise.all([
      prisma.project.count({ where: { status: { not: 'complete' } } }),
      prisma.project.groupBy({ by: ['status'], _count: true }),
      prisma.task.findMany({
        where: { dueDate: { lt: now }, status: { not: 'complete' } },
        take: 10,
        include: { project: { select: { name: true } } },
      }),
      prisma.project.findMany({
        where: { status: 'waiting_on_client' },
        take: 10,
        include: { company: { select: { name: true } } },
      }),
      prisma.message.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { sender: { select: { fullName: true } } },
      }),
      prisma.nudge.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { fullName: true } }, project: { select: { name: true } } },
      }),
      prisma.task.findMany({
        where: {
          dueDate: { gte: now, lte: new Date(now.getTime() + 14 * 86400000) },
          status: { not: 'complete' },
        },
        take: 10,
        orderBy: { dueDate: 'asc' },
      }),
      prisma.approval.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.file.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    return success(res, {
      activeProjectCount: activeProjects,
      projectsByStatus,
      overdueTasks,
      waitingOnClient,
      recentMessages,
      recentNudges,
      upcomingDeadlines,
      recentApprovals,
      recentFiles,
    });
  } catch (err) {
    next(err);
  }
}

export async function client(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'client') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Client dashboard only', 403);
    }
    const companyIds = await getClientCompanyIds(req.user!.id);
    const visibility = updateVisibilityFilter(req.user!);
    const [activeProjects, latestUpdates, waitingOnClient, approvalsNeeded, recentFiles, messages] =
      await Promise.all([
        prisma.project.findMany({
          where: { companyId: { in: companyIds }, status: { not: 'complete' } },
          include: { services: { select: { serviceName: true, progress: true } } },
        }),
        prisma.projectUpdate.findMany({
          where: { project: { companyId: { in: companyIds } }, ...visibility },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.project.findMany({
          where: { companyId: { in: companyIds }, status: 'waiting_on_client' },
        }),
        prisma.approval.findMany({
          where: {
            project: { companyId: { in: companyIds } },
            status: 'waiting_for_client',
          },
        }),
        prisma.file.findMany({
          where: { companyId: { in: companyIds } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.message.findMany({
          where: {
            internalOnly: false,
            conversation: {
              members: { some: { userId: req.user!.id } },
              type: 'client_project',
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ]);
    return success(res, {
      activeProjects,
      latestUpdates,
      waitingOnClient,
      approvalsNeeded,
      recentFiles,
      messages,
    });
  } catch (err) {
    next(err);
  }
}

export async function salesman(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'salesman') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Salesman dashboard only', 403);
    }
    const scope = await projectWhereForUser(req.user!);
    const [assignedProjects, latestUpdates, nudges, internalNotes] = await Promise.all([
      prisma.project.findMany({
        where: scope,
        include: { company: { select: { name: true } } },
      }),
      prisma.projectUpdate.findMany({
        where: { project: scope },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.nudge.findMany({
        where: { project: scope },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { fullName: true } }, project: { select: { name: true } } },
      }),
      prisma.internalNote.findMany({
        where: { project: scope },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    const projectsByStatus = assignedProjects.reduce(
      (acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return success(res, {
      assignedProjects,
      projectsByStatus,
      latestUpdates,
      nudges,
      internalNotes,
    });
  } catch (err) {
    next(err);
  }
}

export async function employee(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'employee') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Employee dashboard only', 403);
    }
    const userId = req.user!.id;
    const now = new Date();
    const [assignedTasks, assignedProjects, upcomingDeadlines, internalMessages, deliverablesNeedingUpload] =
      await Promise.all([
        prisma.task.findMany({
          where: { assignedTo: userId, status: { not: 'complete' } },
          include: { project: { select: { name: true } } },
        }),
        prisma.project.findMany({
          where: {
            OR: [
              { projectManagerId: userId },
              { teamMembers: { some: { userId } } },
            ],
          },
        }),
        prisma.task.findMany({
          where: {
            assignedTo: userId,
            dueDate: { gte: now, lte: new Date(now.getTime() + 14 * 86400000) },
            status: { not: 'complete' },
          },
          orderBy: { dueDate: 'asc' },
        }),
        prisma.message.findMany({
          where: {
            internalOnly: true,
            conversation: { members: { some: { userId } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.file.findMany({
          where: {
            status: 'needs_review',
            project: {
              OR: [
                { projectManagerId: userId },
                { teamMembers: { some: { userId } } },
              ],
            },
          },
          take: 10,
        }),
      ]);
    return success(res, {
      assignedTasks,
      assignedProjects,
      upcomingDeadlines,
      internalMessages,
      deliverablesNeedingUpload,
    });
  } catch (err) {
    next(err);
  }
}
