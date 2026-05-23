import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { success } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  activeTaskWhere,
  projectWhereForUser,
  getClientCompanyIds,
  taskWhereForUser,
  updateVisibilityFilter,
} from '../permissions/filters';
import {
  mapDashboardApproval,
  mapDashboardDeadline,
  mapDashboardFile,
  mapDashboardProject,
  mapDashboardTask,
  mapDashboardUpdate,
} from '../services/dashboard.service';
import {
  recentConversationsForUser,
  totalUnreadForUser,
} from '../services/conversation-read.service';

const projectInclude = { company: { select: { id: true, name: true, logoUrl: true } } };
const taskDeadlineInclude = { project: { select: { name: true } } };
const updateInclude = { project: { select: { name: true } } };

const waitingOnClientTaskWhere = {
  ...activeTaskWhere,
  status: 'waiting_on_client' as const,
};

export async function admin(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Admin dashboard only', 403);
    }
    const now = new Date();
    const inTwoWeeks = new Date(now.getTime() + 14 * 86400000);
    const activeWhere = { status: { not: 'complete' as const } };

    const [
      activeProjectCount,
      waitingOnClientCount,
      waitingOnClientTasks,
      pendingApprovalCount,
      unreadMessageCount,
      recentConversations,
      projects,
      recentUpdates,
      upcomingDeadlines,
      pendingApprovals,
      recentFiles,
    ] = await Promise.all([
      prisma.project.count({ where: activeWhere }),
      prisma.task.count({ where: waitingOnClientTaskWhere }),
      prisma.task.findMany({
        where: waitingOnClientTaskWhere,
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: taskDeadlineInclude,
      }),
      prisma.approval.count({ where: { status: 'waiting_for_client' } }),
      totalUnreadForUser(req.user!),
      recentConversationsForUser(req.user!),
      prisma.project.findMany({
        where: activeWhere,
        orderBy: { updatedAt: 'desc' },
        take: 12,
        include: projectInclude,
      }),
      prisma.projectUpdate.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: updateInclude,
      }),
      prisma.task.findMany({
        where: {
          archivedAt: null,
          dueDate: { gte: now, lte: inTwoWeeks },
          status: { not: 'complete' },
        },
        take: 10,
        orderBy: { dueDate: 'asc' },
        include: taskDeadlineInclude,
      }),
      prisma.approval.findMany({
        where: { status: 'waiting_for_client' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.file.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    return success(res, {
      stats: {
        activeProjects: activeProjectCount,
        waitingOnClient: waitingOnClientCount,
        pendingApprovals: pendingApprovalCount,
        unreadMessages: unreadMessageCount,
      },
      projects: projects.map(mapDashboardProject),
      recentUpdates: recentUpdates.map(mapDashboardUpdate),
      upcomingDeadlines: upcomingDeadlines.map(mapDashboardDeadline),
      pendingApprovals: pendingApprovals.map(mapDashboardApproval),
      recentFiles: recentFiles.map(mapDashboardFile),
      waitingOnClientTasks: waitingOnClientTasks.map(mapDashboardTask),
      recentConversations,
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
    const activeWhere = { companyId: { in: companyIds }, status: { not: 'complete' as const } };

    const [
      activeProjects,
      latestUpdates,
      waitingOnClient,
      approvalsNeeded,
      recentFiles,
      unreadMessageCount,
      recentConversations,
    ] = await Promise.all([
      prisma.project.findMany({
        where: activeWhere,
        orderBy: { updatedAt: 'desc' },
        include: projectInclude,
      }),
      prisma.projectUpdate.findMany({
        where: { project: { companyId: { in: companyIds } }, ...visibility },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: updateInclude,
      }),
      prisma.project.findMany({
        where: { companyId: { in: companyIds }, status: 'waiting_on_client' },
        include: projectInclude,
      }),
      prisma.approval.findMany({
        where: {
          project: { companyId: { in: companyIds } },
          status: 'waiting_for_client',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.file.findMany({
        where: { companyId: { in: companyIds } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      totalUnreadForUser(req.user!),
      recentConversationsForUser(req.user!),
    ]);

    const needsFromClient = waitingOnClient.map((p) => ({
      id: p.id,
      title: p.name,
      description: p.clientFacingNotes ?? 'We need your input to keep moving forward.',
    }));

    return success(res, {
      stats: {
        activeProjects: activeProjects.length,
        waitingOnClient: waitingOnClient.length,
        pendingApprovals: approvalsNeeded.length,
        unreadMessages: unreadMessageCount,
      },
      projects: activeProjects.map(mapDashboardProject),
      recentUpdates: latestUpdates.map(mapDashboardUpdate),
      needsFromClient,
      pendingApprovals: approvalsNeeded.map(mapDashboardApproval),
      recentFiles: recentFiles.map(mapDashboardFile),
      recentConversations,
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
    const taskScope = await taskWhereForUser(req.user!);
    const activeWhere = { AND: [scope, { status: { not: 'complete' as const } }] };
    const waitingTaskWhere = { AND: [taskScope, waitingOnClientTaskWhere] };

    const [
      assignedProjects,
      latestUpdates,
      pendingApprovals,
      unreadMessageCount,
      recentConversations,
      waitingOnClientCount,
      waitingOnClientTasks,
    ] = await Promise.all([
      prisma.project.findMany({
        where: activeWhere,
        orderBy: { updatedAt: 'desc' },
        include: projectInclude,
      }),
      prisma.projectUpdate.findMany({
        where: { project: scope },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: updateInclude,
      }),
      prisma.approval.findMany({
        where: { project: scope, status: 'waiting_for_client' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      totalUnreadForUser(req.user!),
      recentConversationsForUser(req.user!),
      prisma.task.count({ where: waitingTaskWhere }),
      prisma.task.findMany({
        where: waitingTaskWhere,
        orderBy: { updatedAt: 'desc' },
        take: 6,
        include: taskDeadlineInclude,
      }),
    ]);

    return success(res, {
      stats: {
        activeProjects: assignedProjects.length,
        waitingOnClient: waitingOnClientCount,
        pendingApprovals: pendingApprovals.length,
        unreadMessages: unreadMessageCount,
      },
      projects: assignedProjects.map(mapDashboardProject),
      recentUpdates: latestUpdates.map(mapDashboardUpdate),
      pendingApprovals: pendingApprovals.map(mapDashboardApproval),
      waitingOnClientTasks: waitingOnClientTasks.map(mapDashboardTask),
      recentConversations,
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
    const inTwoWeeks = new Date(now.getTime() + 14 * 86400000);
    const projectScope = {
      OR: [{ projectManagerId: userId }, { teamMembers: { some: { userId } } }],
    };

    const employeeWaitingTaskWhere = {
      archivedAt: null,
      assignedTo: userId,
      status: 'waiting_on_client' as const,
    };

    const [
      assignedTasks,
      assignedProjects,
      upcomingDeadlines,
      unreadMessageCount,
      recentConversations,
      pendingApprovalCount,
      deliverablesNeedingUpload,
      waitingOnClientCount,
      waitingOnClientTasks,
    ] = await Promise.all([
        prisma.task.findMany({
          where: { archivedAt: null, assignedTo: userId, status: { not: 'complete' } },
          orderBy: { dueDate: 'asc' },
          take: 12,
          include: taskDeadlineInclude,
        }),
        prisma.project.findMany({
          where: { ...projectScope, status: { not: 'complete' } },
          orderBy: { updatedAt: 'desc' },
          include: projectInclude,
        }),
        prisma.task.findMany({
          where: {
            archivedAt: null,
            assignedTo: userId,
            dueDate: { gte: now, lte: inTwoWeeks },
            status: { not: 'complete' },
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
          include: taskDeadlineInclude,
        }),
        totalUnreadForUser(req.user!),
        recentConversationsForUser(req.user!),
        prisma.approval.count({
          where: { project: projectScope, status: 'waiting_for_client' },
        }),
        prisma.file.findMany({
          where: {
            status: 'needs_review',
            project: projectScope,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.task.count({ where: employeeWaitingTaskWhere }),
        prisma.task.findMany({
          where: employeeWaitingTaskWhere,
          orderBy: { updatedAt: 'desc' },
          take: 6,
          include: taskDeadlineInclude,
        }),
      ]);

    return success(res, {
      stats: {
        activeProjects: assignedProjects.length,
        waitingOnClient: waitingOnClientCount,
        pendingApprovals: pendingApprovalCount,
        unreadMessages: unreadMessageCount,
      },
      projects: assignedProjects.map(mapDashboardProject),
      assignedTasks: assignedTasks.map(mapDashboardTask),
      upcomingDeadlines: upcomingDeadlines.map(mapDashboardDeadline),
      recentFiles: deliverablesNeedingUpload.map(mapDashboardFile),
      waitingOnClientTasks: waitingOnClientTasks.map(mapDashboardTask),
      recentConversations,
    });
  } catch (err) {
    next(err);
  }
}
