import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient, stripClientForbiddenFields } from '../permissions/access';
import { companyWhereForUser } from '../permissions/filters';

function mapCompanyBody(body: Record<string, unknown>) {
  return {
    name: body.name as string,
    website: body.website as string | undefined,
    industry: body.industry as string | undefined,
    mainContactName: body.main_contact_name as string | undefined,
    mainContactEmail: body.main_contact_email as string | undefined,
    mainContactPhone: body.main_contact_phone as string | undefined,
    assignedSalesmanId: body.assigned_salesman_id as string | undefined,
    assignedProjectManagerId: body.assigned_project_manager_id as string | undefined,
    status: body.status as 'active' | 'inactive' | 'prospect' | undefined,
    notes: body.notes as string | undefined,
  };
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, search, status, sortBy, sortOrder } = parsePagination(req.query);
    const scope = await companyWhereForUser(req.user!);
    const where = {
      ...scope,
      ...(status ? { status: status as 'active' | 'inactive' | 'prospect' } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          assignedSalesman: { select: { id: true, fullName: true, email: true } },
          assignedProjectManager: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.company.count({ where }),
    ]);
    const data = companies.map((c) =>
      req.user!.role === 'client' ? { ...c, notes: undefined } : c,
    );
    return success(res, data, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessCompany(req.user!, getParam(req, 'id'));
    const company = await prisma.company.findUnique({
      where: { id: getParam(req, 'id') },
      include: {
        assignedSalesman: { select: { id: true, fullName: true, email: true } },
        assignedProjectManager: { select: { id: true, fullName: true, email: true } },
        projects: { select: { id: true, name: true, status: true, overallProgress: true } },
      },
    });
    if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    const data = req.user!.role === 'client' ? { ...company, notes: undefined } : company;
    return success(res, data);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    if (req.user!.role === 'salesman') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Salesmen cannot create companies', 403);
    }
    const company = await prisma.company.create({ data: mapCompanyBody(req.body) });
    return created(res, company);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessCompany(req.user!, getParam(req, 'id'));
    assertNotClient(req.user!);
    const body = stripClientForbiddenFields(req.body, req.user!, ['notes']);
    const company = await prisma.company.update({
      where: { id: getParam(req, 'id') },
      data: mapCompanyBody(body),
    });
    return success(res, company);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    if (req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Only admins can delete companies', 403);
    }
    await prisma.company.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
