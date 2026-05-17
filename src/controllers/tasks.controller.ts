import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  assertCanAccessCompany,
  assertCanAccessProject,
  assertCanModifyTask,
  assertNotClient,
} from '../permissions/access';
import { activeTaskWhere, taskWhereForUser, taskCommentInternalFilter } from '../permissions/filters';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, search, status, sortBy, sortOrder, companyId, projectId } =
      parsePagination(req.query, { maxLimit: 500 });
    if (companyId) await assertCanAccessCompany(req.user!, companyId);
    if (projectId) await assertCanAccessProject(req.user!, projectId);
    const includeArchived = req.query.include_archived === 'true';
    const archivedOnly = req.query.archived_only === 'true';
    const scope = await taskWhereForUser(req.user!);
    const where = {
      ...scope,
      ...(archivedOnly
        ? { archivedAt: { not: null } }
        : includeArchived
          ? {}
          : activeTaskWhere),
      ...(projectId ? { projectId } : {}),
      ...(companyId ? { project: { companyId } } : {}),
      ...(status ? { status: status as never } : {}),
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              company: { select: { id: true, name: true } },
            },
          },
          assignee: { select: { id: true, fullName: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);
    return success(res, tasks, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await taskWhereForUser(req.user!);
    const task = await prisma.task.findFirst({
      where: { AND: [{ id: getParam(req, 'id') }, scope] },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            company: { select: { id: true, name: true } },
          },
        },
        assignee: { select: { id: true, fullName: true, email: true } },
        comments: {
          where: taskCommentInternalFilter(req.user!),
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!task) throw new AppError(ErrorCodes.NOT_FOUND, 'Task not found', 404);
    return success(res, task);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    await assertCanAccessProject(req.user!, body.project_id);
    if (req.user!.role === 'client' && !body.client_visible) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Clients can only create client-visible tasks via requests', 403);
    }
    const task = await prisma.task.create({
      data: {
        projectId: body.project_id,
        projectServiceId: body.project_service_id,
        title: body.title,
        description: body.description,
        assignedTo: body.assigned_to,
        status: body.status ?? 'backlog',
        priority: body.priority,
        dueDate: body.due_date ? new Date(body.due_date) : undefined,
        clientVisible: body.client_visible ?? false,
        createdBy: req.user!.id,
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            company: { select: { id: true, name: true } },
          },
        },
        assignee: { select: { id: true, fullName: true } },
      },
    });
    return created(res, task);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanModifyTask(req.user!, getParam(req, 'id'));
    const body = req.body;
    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.assigned_to !== undefined) data.assignedTo = body.assigned_to;
    if (body.status !== undefined) data.status = body.status;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.due_date !== undefined) {
      data.dueDate = body.due_date ? new Date(body.due_date) : null;
    }
    if (req.user!.role !== 'client' && body.client_visible !== undefined) {
      data.clientVisible = body.client_visible;
    }
    if (body.archived !== undefined) {
      assertNotClient(req.user!);
      data.archivedAt = body.archived ? new Date() : null;
    }
    if (Object.keys(data).length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No fields to update', 400);
    }
    const task = await prisma.task.update({
      where: { id: getParam(req, 'id') },
      data,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            company: { select: { id: true, name: true } },
          },
        },
        assignee: { select: { id: true, fullName: true } },
      },
    });
    return success(res, task);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    await assertCanModifyTask(req.user!, getParam(req, 'id'));
    await prisma.task.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function listComments(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanModifyTask(req.user!, getParam(req, 'id'));
    const comments = await prisma.taskComment.findMany({
      where: { taskId: getParam(req, 'id'), ...taskCommentInternalFilter(req.user!) },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return success(res, comments);
  } catch (err) {
    next(err);
  }
}

export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanModifyTask(req.user!, getParam(req, 'id'));
    const body = req.body;
    let internalOnly = body.internal_only ?? true;
    if (req.user!.role === 'client') internalOnly = false;
    const comment = await prisma.taskComment.create({
      data: {
        taskId: getParam(req, 'id'),
        userId: req.user!.id,
        comment: body.comment,
        internalOnly,
      },
    });
    return created(res, comment);
  } catch (err) {
    next(err);
  }
}
