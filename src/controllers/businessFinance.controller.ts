import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertNotClient, assertRole } from '../permissions/access';
import { buildBusinessFinanceSummary } from '../services/businessFinance.service';

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

function serializeBusinessExpense(row: {
  id: string;
  name: string;
  vendor: string | null;
  expenseType: string;
  amountCents: number;
  currency: string;
  isActive: boolean;
  serviceCategory: string | null;
  startedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    expenseType: row.expenseType,
    amountCents: row.amountCents,
    amount: row.amountCents / 100,
    currency: row.currency,
    isActive: row.isActive,
    serviceCategory: row.serviceCategory,
    startedAt: row.startedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSummary(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin');
    const month = req.query.month as string | undefined;
    const summary = await buildBusinessFinanceSummary(month);
    return success(res, summary);
  } catch (err) {
    next(err);
  }
}

export async function listRecurringExpenses(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin');
    const rows = await prisma.businessRecurringExpense.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return success(res, rows.map(serializeBusinessExpense));
  } catch (err) {
    next(err);
  }
}

export async function createRecurringExpense(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin');
    const {
      name,
      vendor,
      expense_type: expenseType = 'other',
      amount,
      currency = 'USD',
      is_active: isActive = true,
      service_category: serviceCategory,
      started_at: startedAtRaw,
      notes,
    } = req.body;

    const row = await prisma.businessRecurringExpense.create({
      data: {
        name,
        vendor: vendor ?? null,
        expenseType,
        amountCents: dollarsToCents(amount),
        currency: currency.toUpperCase(),
        isActive: !!isActive,
        serviceCategory: serviceCategory ?? null,
        startedAt: startedAtRaw ? new Date(startedAtRaw) : null,
        notes: notes ?? null,
      },
    });

    return created(res, serializeBusinessExpense(row));
  } catch (err) {
    next(err);
  }
}

export async function updateRecurringExpense(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin');
    const id = getParam(req, 'id');
    const existing = await prisma.businessRecurringExpense.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Business expense not found', 404);
    }

    const body = req.body;
    const row = await prisma.businessRecurringExpense.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.vendor !== undefined && { vendor: body.vendor ?? null }),
        ...(body.expense_type !== undefined && { expenseType: body.expense_type }),
        ...(body.amount !== undefined && { amountCents: dollarsToCents(body.amount) }),
        ...(body.currency !== undefined && { currency: body.currency.toUpperCase() }),
        ...(body.is_active !== undefined && { isActive: !!body.is_active }),
        ...(body.service_category !== undefined && {
          serviceCategory: body.service_category ?? null,
        }),
        ...(body.started_at !== undefined && {
          startedAt: body.started_at ? new Date(body.started_at) : null,
        }),
        ...(body.notes !== undefined && { notes: body.notes ?? null }),
      },
    });

    return success(res, serializeBusinessExpense(row));
  } catch (err) {
    next(err);
  }
}

export async function removeRecurringExpense(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin');
    const id = getParam(req, 'id');
    const existing = await prisma.businessRecurringExpense.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Business expense not found', 404);
    }
    await prisma.businessRecurringExpense.delete({ where: { id } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
