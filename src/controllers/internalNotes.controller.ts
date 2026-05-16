import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject, assertCanAccessCompany, canSeeInternal } from '../permissions/access';
import { projectWhereForUser } from '../permissions/filters';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const { page, limit, skip } = parsePagination(req.query);
    const projectScope = await projectWhereForUser(req.user!);
    const where = {
      OR: [
        { project: projectScope },
        { company: { projects: { some: projectScope } } },
      ],
    };
    const [notes, total] = await Promise.all([
      prisma.internalNote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { id: true, fullName: true } } },
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
    });
    return created(res, note);
  } catch (err) {
    next(err);
  }
}
