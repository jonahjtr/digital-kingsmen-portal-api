import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertCanAccessProject } from '../permissions/access';
import { getClientCompanyIds } from '../permissions/filters';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, status, companyId, projectId } = parsePagination(req.query);
    if (companyId) await assertCanAccessCompany(req.user!, companyId);
    if (projectId) await assertCanAccessProject(req.user!, projectId);
    let where: Record<string, unknown> = {};
    if (req.user!.role === 'client') {
      const companyIds = await getClientCompanyIds(req.user!.id);
      where = { companyId: { in: companyIds } };
    } else if (req.user!.role !== 'admin') {
      const companies = await prisma.company.findMany({
        where: {
          OR: [
            { assignedSalesmanId: req.user!.id },
            { assignedProjectManagerId: req.user!.id },
            { projects: { some: { teamMembers: { some: { userId: req.user!.id } } } } },
          ],
        },
        select: { id: true },
      });
      where = { companyId: { in: companies.map((c) => c.id) } };
    }
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (projectId) where.projectId = projectId;
    const [requests, total] = await Promise.all([
      prisma.clientRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { company: { select: { id: true, name: true } } },
      }),
      prisma.clientRequest.count({ where }),
    ]);
    return success(res, requests, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const request = await prisma.clientRequest.findUnique({
      where: { id: getParam(req, 'id') },
      include: { company: true, project: true, submitter: { select: { id: true, fullName: true } } },
    });
    if (!request) throw new AppError(ErrorCodes.NOT_FOUND, 'Request not found', 404);
    await assertCanAccessCompany(req.user!, request.companyId);
    return success(res, request);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    await assertCanAccessCompany(req.user!, body.company_id);
    if (body.project_id) await assertCanAccessProject(req.user!, body.project_id);
    const clientRequest = await prisma.clientRequest.create({
      data: {
        companyId: body.company_id,
        projectId: body.project_id,
        submittedBy: req.user!.id,
        requestType: body.request_type,
        title: body.title,
        description: body.description,
      },
    });
    return created(res, clientRequest);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.clientRequest.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Request not found', 404);
    await assertCanAccessCompany(req.user!, existing.companyId);
    if (req.user!.role === 'client' && existing.submittedBy !== req.user!.id) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const body = req.body;
    const updated = await prisma.clientRequest.update({
      where: { id: getParam(req, 'id') },
      data: {
        status: req.user!.role === 'client' ? undefined : body.status,
        title: body.title,
        description: body.description,
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function convertToTask(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'client') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Clients cannot convert requests', 403);
    }
    const clientRequest = await prisma.clientRequest.findUnique({ where: { id: getParam(req, 'id') } });
    if (!clientRequest) throw new AppError(ErrorCodes.NOT_FOUND, 'Request not found', 404);
    if (!clientRequest.projectId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Request must be linked to a project', 400);
    }
    const task = await prisma.task.create({
      data: {
        projectId: clientRequest.projectId,
        title: clientRequest.title,
        description: clientRequest.description,
        status: 'todo',
        clientVisible: true,
        createdBy: req.user!.id,
      },
    });
    await prisma.clientRequest.update({
      where: { id: getParam(req, 'id') },
      data: { status: 'in_progress', convertedTaskId: task.id },
    });
    return created(res, { task, clientRequestId: getParam(req, 'id') });
  } catch (err) {
    next(err);
  }
}
