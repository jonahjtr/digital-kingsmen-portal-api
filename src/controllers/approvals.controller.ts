import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject } from '../permissions/access';
import { projectWhereForUser } from '../permissions/filters';
import { createNotification } from '../services/notification.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, status } = parsePagination(req.query);
    const projectScope = await projectWhereForUser(req.user!);
    const where = { project: projectScope, ...(status ? { status: status as never } : {}) };
    const [approvals, total] = await Promise.all([
      prisma.approval.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { id: true, name: true } },
          file: { select: { id: true, fileName: true, fileUrl: true } },
        },
      }),
      prisma.approval.count({ where }),
    ]);
    return success(res, approvals, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await prisma.approval.findUnique({
      where: { id: getParam(req, 'id') },
      include: {
        comments: { include: { user: { select: { id: true, fullName: true } } } },
        file: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (!approval) throw new AppError(ErrorCodes.NOT_FOUND, 'Approval not found', 404);
    await assertCanAccessProject(req.user!, approval.projectId);
    return success(res, approval);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    await assertCanAccessProject(req.user!, body.project_id);
    if (req.user!.role === 'client') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Clients cannot create approvals', 403);
    }
    const approval = await prisma.approval.create({
      data: {
        projectId: body.project_id,
        fileId: body.file_id,
        title: body.title,
        description: body.description,
        requestedBy: req.user!.id,
      },
    });
    return created(res, approval);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await prisma.approval.findUnique({ where: { id: getParam(req, 'id') } });
    if (!approval) throw new AppError(ErrorCodes.NOT_FOUND, 'Approval not found', 404);
    await assertCanAccessProject(req.user!, approval.projectId);
    const body = req.body;
    const updated = await prisma.approval.update({
      where: { id: getParam(req, 'id') },
      data: {
        title: body.title,
        description: body.description,
        status: req.user!.role === 'client' ? undefined : body.status,
        clientComments: body.client_comments,
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await prisma.approval.findUnique({ where: { id: getParam(req, 'id') } });
    if (!approval) throw new AppError(ErrorCodes.NOT_FOUND, 'Approval not found', 404);
    await assertCanAccessProject(req.user!, approval.projectId);
    if (req.user!.role !== 'client' && req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Only clients can approve deliverables', 403);
    }
    const updated = await prisma.approval.update({
      where: { id: getParam(req, 'id') },
      data: {
        status: 'approved',
        reviewedBy: req.user!.id,
        clientComments: req.body?.client_comments,
      },
    });
    if (approval.fileId) {
      await prisma.file.update({
        where: { id: approval.fileId },
        data: { status: 'approved' },
      });
    }
    await createNotification(
      approval.requestedBy,
      'Deliverable approved',
      `"${approval.title}" was approved by ${req.user!.fullName}`,
      'approval',
    );
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function requestRevision(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await prisma.approval.findUnique({ where: { id: getParam(req, 'id') } });
    if (!approval) throw new AppError(ErrorCodes.NOT_FOUND, 'Approval not found', 404);
    await assertCanAccessProject(req.user!, approval.projectId);
    if (req.user!.role !== 'client' && req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Only clients can request revisions', 403);
    }
    const updated = await prisma.approval.update({
      where: { id: getParam(req, 'id') },
      data: {
        status: 'revisions_requested',
        reviewedBy: req.user!.id,
        clientComments: req.body?.client_comments ?? req.body?.comment,
      },
    });
    if (approval.fileId) {
      await prisma.file.update({
        where: { id: approval.fileId },
        data: { status: 'needs_revision' },
      });
    }
    await createNotification(
      approval.requestedBy,
      'Revisions requested',
      `"${approval.title}" needs revisions`,
      'approval',
    );
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await prisma.approval.findUnique({ where: { id: getParam(req, 'id') } });
    if (!approval) throw new AppError(ErrorCodes.NOT_FOUND, 'Approval not found', 404);
    await assertCanAccessProject(req.user!, approval.projectId);
    const comment = await prisma.approvalComment.create({
      data: {
        approvalId: getParam(req, 'id'),
        userId: req.user!.id,
        comment: req.body.comment,
      },
    });
    return created(res, comment);
  } catch (err) {
    next(err);
  }
}
