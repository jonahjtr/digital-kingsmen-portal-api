import { Request, Response, NextFunction } from 'express';
import { MonthlyServiceStatus, Prisma } from '@prisma/client';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient } from '../permissions/access';
import { companyWhereForUser } from '../permissions/filters';
import { textContains } from '../lib/searchFilter';

const includeCompany = {
  company: {
    select: {
      id: true,
      name: true,
      status: true,
      assignedSalesman: { select: { id: true, fullName: true, email: true } },
    },
  },
} as const;

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

function payoutCentsFromBody(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return dollarsToCents(value as number);
}

function serializeMonthlyService(row: {
  id: string;
  companyId: string;
  serviceCategory: string;
  label: string | null;
  monthlyAmountCents: number;
  salesmanPayoutCents: number | null;
  currency: string;
  status: MonthlyServiceStatus;
  description: string | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  company?: {
    id: string;
    name: string;
    status: string;
    assignedSalesman?: { id: string; fullName: string; email: string } | null;
  };
}) {
  const monthlyAmount = row.monthlyAmountCents / 100;
  const salesmanPayout =
    row.salesmanPayoutCents != null ? row.salesmanPayoutCents / 100 : null;
  return {
    ...row,
    monthlyAmount,
    salesmanPayout,
    netAmount: monthlyAmount - (salesmanPayout ?? 0),
  };
}

async function monthlyServiceWhereForUser(req: Request): Promise<Prisma.CompanyMonthlyServiceWhereInput> {
  const companyScope = await companyWhereForUser(req.user!);
  return {
    company: companyScope,
  };
}

export async function listAll(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const where: Prisma.CompanyMonthlyServiceWhereInput = await monthlyServiceWhereForUser(req);

    const category = req.query.category as string | undefined;
    const status = req.query.status as MonthlyServiceStatus | undefined;
    const companyId = req.query.company_id as string | undefined;
    const salesmanId = req.query.salesman_id as string | undefined;
    const search = req.query.search as string | undefined;

    if (category) where.serviceCategory = category;
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (salesmanId) {
      where.company = {
        ...(typeof where.company === 'object' ? where.company : {}),
        assignedSalesmanId: salesmanId,
      };
    }
    if (search) {
      where.company = {
        ...(typeof where.company === 'object' ? where.company : {}),
        name: textContains(search),
      };
    }

    const rows = await prisma.companyMonthlyService.findMany({
      where,
      include: includeCompany,
      orderBy: [{ company: { name: 'asc' } }, { serviceCategory: 'asc' }],
    });

    return success(res, rows.map(serializeMonthlyService));
  } catch (err) {
    next(err);
  }
}

export async function listForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyId = getParam(req, 'companyId');
    await assertCanAccessCompany(req.user!, companyId);

    const rows = await prisma.companyMonthlyService.findMany({
      where: { companyId },
      include: includeCompany,
      orderBy: [{ status: 'asc' }, { serviceCategory: 'asc' }],
    });

    return success(res, rows.map(serializeMonthlyService));
  } catch (err) {
    next(err);
  }
}

export async function createForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyId = getParam(req, 'companyId');
    await assertCanAccessCompany(req.user!, companyId);

    const {
      service_category: serviceCategory,
      label,
      monthly_amount: monthlyAmount,
      salesman_payout: salesmanPayout,
      currency = 'USD',
      status = 'active',
      description,
      started_at: startedAtRaw,
    } = req.body;

    const row = await prisma.companyMonthlyService.create({
      data: {
        companyId,
        serviceCategory,
        label: label ?? null,
        monthlyAmountCents: dollarsToCents(monthlyAmount),
        salesmanPayoutCents: payoutCentsFromBody(salesmanPayout) ?? null,
        currency: currency.toUpperCase(),
        status: status as MonthlyServiceStatus,
        description: description ?? null,
        startedAt: startedAtRaw ? new Date(startedAtRaw) : null,
      },
      include: includeCompany,
    });

    return created(res, serializeMonthlyService(row));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    const existing = await prisma.companyMonthlyService.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Monthly service not found', 404);
    await assertCanAccessCompany(req.user!, existing.companyId);

    const data: Prisma.CompanyMonthlyServiceUpdateInput = {};
    const body = req.body;

    if (body.service_category !== undefined) data.serviceCategory = body.service_category;
    if (body.label !== undefined) data.label = body.label;
    if (body.monthly_amount !== undefined) {
      data.monthlyAmountCents = dollarsToCents(body.monthly_amount);
    }
    if (body.salesman_payout !== undefined) {
      data.salesmanPayoutCents = payoutCentsFromBody(body.salesman_payout) ?? null;
    }
    if (body.currency !== undefined) data.currency = body.currency.toUpperCase();
    if (body.status !== undefined) data.status = body.status;
    if (body.description !== undefined) data.description = body.description;
    if (body.started_at !== undefined) {
      data.startedAt = body.started_at ? new Date(body.started_at) : null;
    }

    const row = await prisma.companyMonthlyService.update({
      where: { id },
      data,
      include: includeCompany,
    });

    return success(res, serializeMonthlyService(row));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    const existing = await prisma.companyMonthlyService.findUnique({ where: { id } });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Monthly service not found', 404);
    await assertCanAccessCompany(req.user!, existing.companyId);

    await prisma.companyMonthlyService.delete({ where: { id } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
