import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient } from '../permissions/access';
import { companyWhereForUser } from '../permissions/filters';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const companyScope = await companyWhereForUser(req.user!);
    const where = { company: companyScope };
    const [reports, total] = await Promise.all([
      prisma.report.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.report.count({ where }),
    ]);
    return success(res, reports, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const report = await prisma.report.findUnique({ where: { id: getParam(req, 'id') } });
    if (!report) throw new AppError(ErrorCodes.NOT_FOUND, 'Report not found', 404);
    await assertCanAccessCompany(req.user!, report.companyId);
    return success(res, report);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const body = req.body;
    await assertCanAccessCompany(req.user!, body.company_id);
    const report = await prisma.report.create({
      data: {
        companyId: body.company_id,
        projectId: body.project_id,
        reportType: body.report_type,
        title: body.title,
        summary: body.summary,
        metricsJson: body.metrics_json,
        createdBy: req.user!.id,
      },
    });
    return created(res, report);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const report = await prisma.report.findUnique({ where: { id: getParam(req, 'id') } });
    if (!report) throw new AppError(ErrorCodes.NOT_FOUND, 'Report not found', 404);
    await assertCanAccessCompany(req.user!, report.companyId);
    const body = req.body;
    const updated = await prisma.report.update({
      where: { id: getParam(req, 'id') },
      data: {
        projectId: body.project_id,
        reportType: body.report_type,
        title: body.title,
        summary: body.summary,
        metricsJson: body.metrics_json,
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const report = await prisma.report.findUnique({ where: { id: getParam(req, 'id') } });
    if (!report) throw new AppError(ErrorCodes.NOT_FOUND, 'Report not found', 404);
    await assertCanAccessCompany(req.user!, report.companyId);
    await prisma.report.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
