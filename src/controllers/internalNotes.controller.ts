import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  assertCanAccessProject,
  assertCanAccessCompany,
  canSeeInternal,
  isAdmin,
} from '../permissions/access';
import { projectWhereForUser } from '../permissions/filters';

const noteInclude = { creator: { select: { id: true, fullName: true } } };

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const { page, limit, skip } = parsePagination(req.query);
    const companyId = req.query.company_id as string | undefined;

    let where: Record<string, unknown>;
    if (companyId) {
      await assertCanAccessCompany(req.user!, companyId);
      where = { companyId };
    } else {
      const projectScope = await projectWhereForUser(req.user!);
      where = {
        OR: [
          { project: projectScope },
          { company: { projects: { some: projectScope } } },
        ],
      };
    }

    const [notes, total] = await Promise.all([
      prisma.internalNote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: noteInclude,
      }),
      prisma.internalNote.count({ where }),
    ]);
    return success(res, notes, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const body = req.body;
    if (body.project_id) await assertCanAccessProject(req.user!, body.project_id);
    if (body.company_id) await assertCanAccessCompany(req.user!, body.company_id);
    const note = await prisma.internalNote.create({
      data: {
        projectId: body.project_id,
        companyId: body.company_id,
        note: body.note,
        createdBy: req.user!.id,
      },
      include: noteInclude,
    });
    return created(res, note);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const id = getParam(req, 'id');
    const existing = await prisma.internalNote.findUnique({
      where: { id },
      select: { id: true, createdBy: true, companyId: true, projectId: true },
    });
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Note not found', 404);
    }
    if (existing.companyId) {
      await assertCanAccessCompany(req.user!, existing.companyId);
    }
    if (existing.projectId) {
      await assertCanAccessProject(req.user!, existing.projectId);
    }
    if (!isAdmin(req.user!) && existing.createdBy !== req.user!.id) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'You can only edit your own notes', 403);
    }
    const note = await prisma.internalNote.update({
      where: { id },
      data: { note: req.body.note as string },
      include: noteInclude,
    });
    return success(res, note);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const id = getParam(req, 'id');
    const existing = await prisma.internalNote.findUnique({
      where: { id },
      select: { id: true, createdBy: true, companyId: true, projectId: true },
    });
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Note not found', 404);
    }
    if (existing.companyId) {
      await assertCanAccessCompany(req.user!, existing.companyId);
    }
    if (existing.projectId) {
      await assertCanAccessProject(req.user!, existing.projectId);
    }
    if (!isAdmin(req.user!) && existing.createdBy !== req.user!.id) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'You can only delete your own notes', 403);
    }
    await prisma.internalNote.delete({ where: { id } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
