import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  assertCanAccessCompany,
  assertCanAccessProject,
  assertCanCreateTaskAnchors,
  assertCanModifyTask,
  assertNotClient,
} from '../permissions/access';
import { activeTaskWhere, taskWhereForUser, taskCommentInternalFilter } from '../permissions/filters';
import { textContains } from '../lib/searchFilter';
import { resolveTaskSortField } from '../lib/sortFields';
import { resolveTaskAnchors } from '../services/taskAnchors';

const taskInclude = {
  company: { select: { id: true, name: true } },
  project: {
    select: {
      id: true,
      name: true,
      company: { select: { id: true, name: true } },
    },
  },
  assignee: { select: { id: true, fullName: true } },
} as const;

const taskDetailInclude = {
  ...taskInclude,
  assignee: { select: { id: true, fullName: true, email: true } },
  comments: {
    include: { user: { select: { id: true, fullName: true } } },
  },
} as const;

function companyFilter(companyId: string): Prisma.TaskWhereInput {
  return {
    OR: [{ companyId }, { project: { companyId } }],
  };
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, search, status, sortBy, sortOrder, companyId, projectId } =
      parsePagination(req.query, { maxLimit: 500 });
    if (companyId) await assertCanAccessCompany(req.user!, companyId);
    if (projectId) await assertCanAccessProject(req.user!, projectId);
    const includeArchived = req.query.include_archived === 'true';
    const archivedOnly = req.query.archived_only === 'true';
    const scopeMine = req.query.scope === 'mine';
    const scope = await taskWhereForUser(req.user!);
    const where: Prisma.TaskWhereInput = {
      ...scope,
      ...(archivedOnly
        ? { archivedAt: { not: null } }
        : includeArchived
          ? {}
          : activeTaskWhere),
      ...(projectId ? { projectId } : {}),
      ...(companyId ? companyFilter(companyId) : {}),
      ...(status ? { status: status as never } : {}),
      ...(search ? { title: textContains(search) } : {}),
      ...(scopeMine ? { assignedTo: req.user!.id } : {}),
    };
    const orderField = resolveTaskSortField(sortBy, archivedOnly);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: sortOrder },
        include: taskInclude,
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
        ...taskDetailInclude,
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
    if (req.user!.role === 'client' && !body.client_visible) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Clients can only create client-visible tasks via requests', 403);
    }
    const anchors = await resolveTaskAnchors({
      company_id: body.company_id,
      project_id: body.project_id,
      project_service_id: body.project_service_id,
      client_visible: body.client_visible,
    });
    await assertCanCreateTaskAnchors(req.user!, anchors);
    const task = await prisma.task.create({
      data: {
        companyId: anchors.companyId,
        projectId: anchors.projectId,
        projectServiceId: anchors.projectServiceId,
        title: body.title,
        description: body.description,
        assignedTo: body.assigned_to,
        status: body.status ?? 'backlog',
        priority: body.priority,
        dueDate: body.due_date ? new Date(body.due_date) : undefined,
        clientVisible: body.client_visible ?? false,
        createdBy: req.user!.id,
      },
      include: taskInclude,
    });
    return created(res, task);
  } catch (err) {
    next(err);
  }
}

async function resolveAnchorUpdate(
  taskId: string,
  body: Record<string, unknown>,
): Promise<ResolvedAnchorUpdate | null> {
  const hasAnchorUpdate =
    body.company_id !== undefined ||
    body.project_id !== undefined ||
    body.project_service_id !== undefined;
  if (!hasAnchorUpdate) return null;

  const current = await prisma.task.findUnique({ where: { id: taskId } });
  if (!current) throw new AppError(ErrorCodes.NOT_FOUND, 'Task not found', 404);

  let companyId =
    body.company_id !== undefined ? (body.company_id as string | null) : current.companyId;
  let projectId =
    body.project_id !== undefined ? (body.project_id as string | null) : current.projectId;

  if (body.company_id !== undefined && body.project_id === undefined) {
    projectId = null;
  }

  const projectServiceId =
    body.project_service_id !== undefined
      ? (body.project_service_id as string | null)
      : projectId
        ? current.projectServiceId
        : null;

  const clientVisible =
    body.client_visible !== undefined
      ? Boolean(body.client_visible)
      : current.clientVisible;

  const anchors = await resolveTaskAnchors({
    company_id: companyId,
    project_id: projectId,
    project_service_id: projectServiceId,
    client_visible: clientVisible,
  });

  return { anchors, clientVisible };
}

interface ResolvedAnchorUpdate {
  anchors: Awaited<ReturnType<typeof resolveTaskAnchors>>;
  clientVisible: boolean;
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanModifyTask(req.user!, getParam(req, 'id'));
    const body = req.body;
    const data: Prisma.TaskUncheckedUpdateInput = {};

    const anchorUpdate = await resolveAnchorUpdate(getParam(req, 'id'), body);
    if (anchorUpdate) {
      await assertCanCreateTaskAnchors(req.user!, anchorUpdate.anchors);
      data.companyId = anchorUpdate.anchors.companyId;
      data.projectId = anchorUpdate.anchors.projectId;
      data.projectServiceId = anchorUpdate.anchors.projectServiceId;
      if (body.client_visible === undefined && anchorUpdate.clientVisible !== undefined) {
        data.clientVisible = anchorUpdate.clientVisible;
      }
    }

    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.assigned_to !== undefined) data.assignedTo = body.assigned_to;
    if (body.status !== undefined) data.status = body.status;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.due_date !== undefined) {
      data.dueDate = body.due_date ? new Date(body.due_date) : null;
    }
    if (req.user!.role !== 'client' && body.client_visible !== undefined) {
      if (body.client_visible) {
        const nextCompanyId =
          (data.companyId as string | null | undefined) ??
          (await prisma.task.findUnique({ where: { id: getParam(req, 'id') }, select: { companyId: true } }))
            ?.companyId;
        if (!nextCompanyId) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            'client_visible tasks require a company',
            400,
          );
        }
      }
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
      include: taskInclude,
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
