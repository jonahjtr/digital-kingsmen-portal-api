import { Request, Response, NextFunction } from 'express';
import { MonthlyServiceStatus, Prisma } from '@prisma/client';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient } from '../permissions/access';
import { companyWhereForUser } from '../permissions/filters';
import { textContains } from '../lib/searchFilter';
import {
  BILLABLE_REVENUE_CATEGORIES,
  DEFAULT_SALESMAN_SPLIT_PERCENT,
} from '../validators/monthlyServices';

const includeCompany = {
  company: {
    select: {
      id: true,
      name: true,
      status: true,
      assignedSalesman: { select: { id: true, fullName: true, email: true } },
    },
  },
  expenses: {
    orderBy: { name: 'asc' as const },
  },
} as const;

function serializeExpense(row: {
  id: string;
  monthlyServiceId: string;
  name: string;
  vendor: string | null;
  expenseType: string;
  amountCents: number;
  currency: string;
  isRecurring: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    monthlyServiceId: row.monthlyServiceId,
    name: row.name,
    vendor: row.vendor,
    expenseType: row.expenseType,
    amountCents: row.amountCents,
    amount: row.amountCents / 100,
    currency: row.currency,
    isRecurring: row.isRecurring,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sumRecurringExpenseCents(
  expenses: { amountCents: number; isRecurring: boolean }[],
): number {
  return expenses.reduce(
    (sum, e) => sum + (e.isRecurring ? e.amountCents : 0),
    0,
  );
}

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

function computeDefaultPayoutCents(monthlyAmountCents: number): number {
  return Math.round(monthlyAmountCents * (DEFAULT_SALESMAN_SPLIT_PERCENT / 100));
}

function payoutCentsFromBody(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return dollarsToCents(value as number);
}

function parseBillableOnly(query: unknown): boolean {
  if (query === undefined || query === null || query === '') return true;
  return query === 'true' || query === '1';
}

function resolvePayoutOnWrite(
  monthlyAmountCents: number,
  override: boolean,
  explicitPayoutCents: number | null | undefined,
): { salesmanPayoutCents: number | null; salesmanPayoutOverride: boolean } {
  if (override) {
    return {
      salesmanPayoutCents: explicitPayoutCents ?? null,
      salesmanPayoutOverride: true,
    };
  }
  return {
    salesmanPayoutCents: computeDefaultPayoutCents(monthlyAmountCents),
    salesmanPayoutOverride: false,
  };
}

function serializeMonthlyService(row: {
  id: string;
  companyId: string;
  serviceCategory: string;
  label: string | null;
  monthlyAmountCents: number;
  salesmanPayoutCents: number | null;
  salesmanPayoutOverride: boolean;
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
  expenses?: {
    id: string;
    monthlyServiceId: string;
    name: string;
    vendor: string | null;
    expenseType: string;
    amountCents: number;
    currency: string;
    isRecurring: boolean;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
}) {
  const monthlyAmount = row.monthlyAmountCents / 100;
  const defaultSalesmanPayout = computeDefaultPayoutCents(row.monthlyAmountCents) / 100;
  const salesmanPayout = row.salesmanPayoutOverride
    ? row.salesmanPayoutCents != null
      ? row.salesmanPayoutCents / 100
      : null
    : defaultSalesmanPayout;
  const effectivePayout = salesmanPayout ?? 0;
  const expenses = row.expenses ?? [];
  const totalExpensesCents = sumRecurringExpenseCents(expenses);
  const totalExpenses = totalExpensesCents / 100;
  const salesmanSplitPercent =
    row.salesmanPayoutOverride && monthlyAmount > 0 && salesmanPayout != null
      ? Math.round((salesmanPayout / monthlyAmount) * 1000) / 10
      : DEFAULT_SALESMAN_SPLIT_PERCENT;

  const { expenses: _rawExpenses, ...rest } = row;

  return {
    ...rest,
    monthlyAmount,
    defaultSalesmanPayout,
    salesmanPayout,
    salesmanPayoutOverride: row.salesmanPayoutOverride,
    salesmanSplitPercent,
    expenses: expenses.map(serializeExpense),
    totalExpensesCents,
    totalExpenses,
    netAmount: monthlyAmount - effectivePayout - totalExpenses,
  };
}

async function getMonthlyServiceIfAccessible(req: Request, id: string) {
  const existing = await prisma.companyMonthlyService.findUnique({
    where: { id },
    include: includeCompany,
  });
  if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Monthly service not found', 404);
  await assertCanAccessCompany(req.user!, existing.companyId);
  return existing;
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
    const categoriesRaw = req.query.categories as string | undefined;
    const categoryIds = categoriesRaw
      ? categoriesRaw
          .split(',')
          .map((s) => s.trim())
          .filter((id): id is (typeof BILLABLE_REVENUE_CATEGORIES)[number] =>
            (BILLABLE_REVENUE_CATEGORIES as readonly string[]).includes(id),
          )
      : [];
    const status = req.query.status as MonthlyServiceStatus | undefined;
    const companyId = req.query.company_id as string | undefined;
    const salesmanId = req.query.salesman_id as string | undefined;
    const search = req.query.search as string | undefined;
    const billableOnly = parseBillableOnly(req.query.billable_only);

    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (categoryIds.length > 0) {
      where.serviceCategory = { in: categoryIds };
    } else if (category) {
      where.serviceCategory = category;
    } else if (billableOnly) {
      where.serviceCategory = { in: [...BILLABLE_REVENUE_CATEGORIES] };
    }
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

    const billableOnly = parseBillableOnly(req.query.billable_only);

    const rows = await prisma.companyMonthlyService.findMany({
      where: {
        companyId,
        ...(billableOnly
          ? { serviceCategory: { in: [...BILLABLE_REVENUE_CATEGORIES] } }
          : {}),
      },
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
      salesman_payout_override: payoutOverride = false,
      currency = 'USD',
      status = 'active',
      description,
      started_at: startedAtRaw,
    } = req.body;

    const monthlyAmountCents = dollarsToCents(monthlyAmount);
    const payout = resolvePayoutOnWrite(
      monthlyAmountCents,
      !!payoutOverride,
      payoutCentsFromBody(salesmanPayout),
    );

    const row = await prisma.companyMonthlyService.create({
      data: {
        companyId,
        serviceCategory,
        label: label ?? null,
        monthlyAmountCents,
        salesmanPayoutCents: payout.salesmanPayoutCents,
        salesmanPayoutOverride: payout.salesmanPayoutOverride,
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
    const existing = await getMonthlyServiceIfAccessible(req, id);

    const body = req.body;
    const monthlyAmountCents =
      body.monthly_amount !== undefined
        ? dollarsToCents(body.monthly_amount)
        : existing.monthlyAmountCents;

    let payoutOverride = existing.salesmanPayoutOverride;
    if (body.salesman_payout_override !== undefined) {
      payoutOverride = !!body.salesman_payout_override;
    }

    let salesmanPayoutCents = existing.salesmanPayoutCents;
    if (body.salesman_payout !== undefined) {
      salesmanPayoutCents = payoutCentsFromBody(body.salesman_payout) ?? null;
      payoutOverride = true;
    } else if (
      body.monthly_amount !== undefined ||
      body.salesman_payout_override === false
    ) {
      if (!payoutOverride || body.salesman_payout_override === false) {
        payoutOverride = false;
        salesmanPayoutCents = computeDefaultPayoutCents(monthlyAmountCents);
      }
    }

    const data: Prisma.CompanyMonthlyServiceUpdateInput = {
      ...(body.service_category !== undefined && { serviceCategory: body.service_category }),
      ...(body.label !== undefined && { label: body.label }),
      ...(body.monthly_amount !== undefined && { monthlyAmountCents }),
      salesmanPayoutCents,
      salesmanPayoutOverride: payoutOverride,
      ...(body.currency !== undefined && { currency: body.currency.toUpperCase() }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.started_at !== undefined && {
        startedAt: body.started_at ? new Date(body.started_at) : null,
      }),
    };

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
    await getMonthlyServiceIfAccessible(req, id);

    await prisma.companyMonthlyService.delete({ where: { id } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function listExpenses(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const service = await getMonthlyServiceIfAccessible(req, getParam(req, 'id'));
    return success(res, service.expenses.map(serializeExpense));
  } catch (err) {
    next(err);
  }
}

export async function createExpense(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const service = await getMonthlyServiceIfAccessible(req, getParam(req, 'id'));
    const {
      name,
      vendor,
      expense_type: expenseType = 'contractor',
      amount,
      currency = service.currency,
      is_recurring: isRecurring = true,
      notes,
    } = req.body;

    const row = await prisma.companyMonthlyServiceExpense.create({
      data: {
        monthlyServiceId: service.id,
        name,
        vendor: vendor ?? null,
        expenseType,
        amountCents: dollarsToCents(amount),
        currency: String(currency).toUpperCase(),
        isRecurring: !!isRecurring,
        notes: notes ?? null,
      },
    });

    return created(res, serializeExpense(row));
  } catch (err) {
    next(err);
  }
}

export async function updateExpense(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    await getMonthlyServiceIfAccessible(req, getParam(req, 'id'));
    const expenseId = getParam(req, 'expenseId');
    const existing = await prisma.companyMonthlyServiceExpense.findFirst({
      where: { id: expenseId, monthlyServiceId: getParam(req, 'id') },
    });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Expense not found', 404);

    const body = req.body;
    const row = await prisma.companyMonthlyServiceExpense.update({
      where: { id: expenseId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.vendor !== undefined && { vendor: body.vendor ?? null }),
        ...(body.expense_type !== undefined && { expenseType: body.expense_type }),
        ...(body.amount !== undefined && { amountCents: dollarsToCents(body.amount) }),
        ...(body.currency !== undefined && { currency: body.currency.toUpperCase() }),
        ...(body.is_recurring !== undefined && { isRecurring: !!body.is_recurring }),
        ...(body.notes !== undefined && { notes: body.notes ?? null }),
      },
    });

    return success(res, serializeExpense(row));
  } catch (err) {
    next(err);
  }
}

export async function removeExpense(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    await getMonthlyServiceIfAccessible(req, getParam(req, 'id'));
    const expenseId = getParam(req, 'expenseId');
    const existing = await prisma.companyMonthlyServiceExpense.findFirst({
      where: { id: expenseId, monthlyServiceId: getParam(req, 'id') },
    });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Expense not found', 404);

    await prisma.companyMonthlyServiceExpense.delete({ where: { id: expenseId } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
