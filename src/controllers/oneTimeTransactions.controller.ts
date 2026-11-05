import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient, assertRole } from '../permissions/access';
import { oneTimeMoneyScope, stripCosts } from '../permissions/moneyScope';
import { companyWhereForUser } from '../permissions/filters';
import { textContains } from '../lib/searchFilter';
import { parseMonthRange } from '../lib/monthRange';
import {
  computeDefaultPayoutCents,
  defaultSalesmanSplitPercent,
  resolveTransactionPayoutOnWrite,
  resolveTransactionSalesmanId,
  transactionHasSalesman,
} from '../services/oneTimeTransactionPayout';

const includeRelations = {
  company: {
    select: {
      id: true,
      name: true,
      status: true,
      assignedSalesman: { select: { id: true, fullName: true, email: true } },
    },
  },
  project: {
    select: { id: true, name: true, status: true },
  },
  salesman: {
    select: { id: true, fullName: true, email: true },
  },
  expenses: {
    orderBy: { name: 'asc' as const },
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

function sumExpenseCents(
  expenses: { amountCents: number }[],
): number {
  return expenses.reduce((sum, e) => sum + e.amountCents, 0);
}

function serializeExpense(row: {
  id: string;
  transactionId: string;
  name: string;
  vendor: string | null;
  expenseType: string;
  amountCents: number;
  currency: string;
  spentAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    name: row.name,
    vendor: row.vendor,
    expenseType: row.expenseType,
    amountCents: row.amountCents,
    amount: row.amountCents / 100,
    currency: row.currency,
    spentAt: row.spentAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeTransaction(row: {
  id: string;
  companyId: string;
  projectId: string | null;
  salesmanId: string | null;
  title: string;
  description: string | null;
  category: string;
  amountCents: number;
  currency: string;
  recognizedAt: Date;
  paymentStatus: string;
  salesmanPayoutCents: number | null;
  salesmanPayoutOverride: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  company?: {
    id: string;
    name: string;
    status: string;
    assignedSalesman?: { id: string; fullName: string; email: string } | null;
  };
  project?: { id: string; name: string; status: string } | null;
  salesman?: { id: string; fullName: string; email: string } | null;
  expenses?: {
    id: string;
    transactionId: string;
    name: string;
    vendor: string | null;
    expenseType: string;
    amountCents: number;
    currency: string;
    spentAt: Date | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
}) {
  const effectiveSalesman =
    row.salesman ??
    row.company?.assignedSalesman ??
    null;
  const hasSalesman = transactionHasSalesman(effectiveSalesman);
  const amount = row.amountCents / 100;
  const defaultSalesmanPayout =
    computeDefaultPayoutCents(row.amountCents, hasSalesman) / 100;
  const salesmanPayout = !hasSalesman
    ? 0
    : row.salesmanPayoutOverride
      ? row.salesmanPayoutCents != null
        ? row.salesmanPayoutCents / 100
        : null
      : defaultSalesmanPayout;
  const effectivePayout = salesmanPayout ?? 0;
  const expenses = row.expenses ?? [];
  const totalExpensesCents = sumExpenseCents(expenses);
  const totalExpenses = totalExpensesCents / 100;
  const salesmanSplitPercent = !hasSalesman
    ? 0
    : row.salesmanPayoutOverride && amount > 0 && salesmanPayout != null
      ? Math.round((salesmanPayout / amount) * 1000) / 10
      : defaultSalesmanSplitPercent(true);

  const { expenses: _rawExpenses, ...rest } = row;

  return {
    ...rest,
    amount,
    defaultSalesmanPayout,
    salesmanPayout,
    salesmanPayoutOverride: row.salesmanPayoutOverride,
    salesmanSplitPercent,
    expenses: expenses.map(serializeExpense),
    totalExpensesCents,
    totalExpenses,
    netAmount: amount - effectivePayout - totalExpenses,
    effectiveSalesman,
  };
}

async function getTransactionIfAccessible(req: Request, id: string) {
  const existing = await prisma.companyOneTimeTransaction.findUnique({
    where: { id },
    include: includeRelations,
  });
  if (!existing) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'One-time transaction not found', 404);
  }
  await assertCanAccessCompany(req.user!, existing.companyId);
  const inScope = await prisma.companyOneTimeTransaction.count({ where: { AND: [{ id: existing.id }, await oneTimeMoneyScope(req.user!)] } });
  if (!inScope) throw new AppError(ErrorCodes.NOT_FOUND, 'One-time transaction not found', 404);
  return existing;
}

async function transactionWhereForUser(
  req: Request,
): Promise<Prisma.CompanyOneTimeTransactionWhereInput> {
  const companyScope = await companyWhereForUser(req.user!);
  return { AND: [{ company: companyScope }, await oneTimeMoneyScope(req.user!)] };
}

async function assertProjectBelongsToCompany(
  projectId: string | null | undefined,
  companyId: string,
): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: { id: true },
  });
  if (!project) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Project must belong to the selected client',
      400,
    );
  }
}

export async function listAll(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const where: Prisma.CompanyOneTimeTransactionWhereInput =
      await transactionWhereForUser(req);

    const month = req.query.month as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const salesmanId = req.query.salesman_id as string | undefined;
    const projectId = req.query.project_id as string | undefined;
    const category = req.query.category as string | undefined;
    const paymentStatus = req.query.payment_status as string | undefined;
    const search = req.query.search as string | undefined;

    if (month) {
      const { start, end } = parseMonthRange(month);
      where.recognizedAt = { gte: start, lt: end };
    }
    if (companyId) where.companyId = companyId;
    if (projectId) where.projectId = projectId;
    if (category) where.category = category as Prisma.EnumOneTimeTransactionCategoryFilter;
    if (paymentStatus) {
      where.paymentStatus = paymentStatus as Prisma.EnumOneTimePaymentStatusFilter;
    }
    if (salesmanId) {
      where.OR = [
        { salesmanId },
        {
          salesmanId: null,
          company: { assignedSalesmanId: salesmanId },
        },
      ];
    }
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { title: textContains(search) },
            { company: { name: textContains(search) } },
            { project: { name: textContains(search) } },
          ],
        },
      ];
    }

    const rows = await prisma.companyOneTimeTransaction.findMany({
      where,
      include: includeRelations,
      orderBy: [{ recognizedAt: 'desc' }, { title: 'asc' }],
    });

    return success(res, rows.map((r) => stripCosts(serializeTransaction(r), req.user!)));
  } catch (err) {
    next(err);
  }
}

export async function listForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyId = getParam(req, 'companyId');
    await assertCanAccessCompany(req.user!, companyId);

    const month = req.query.month as string | undefined;
    const where: Prisma.CompanyOneTimeTransactionWhereInput = {
      AND: [await oneTimeMoneyScope(req.user!)],
      companyId,
    };
    if (month) {
      const { start, end } = parseMonthRange(month);
      where.recognizedAt = { gte: start, lt: end };
    }

    const rows = await prisma.companyOneTimeTransaction.findMany({
      where,
      include: includeRelations,
      orderBy: [{ recognizedAt: 'desc' }, { title: 'asc' }],
    });

    return success(res, rows.map((r) => stripCosts(serializeTransaction(r), req.user!)));
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
      title,
      description,
      category = 'other',
      amount,
      currency = 'USD',
      recognized_at: recognizedAtRaw,
      payment_status: paymentStatus = 'unpaid',
      project_id: projectId,
      salesman_id: explicitSalesmanId,
      salesman_payout: salesmanPayout,
      salesman_payout_override: payoutOverride = false,
      notes,
    } = req.body;

    await assertProjectBelongsToCompany(projectId, companyId);

    const amountCents = dollarsToCents(amount);
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { assignedSalesmanId: true },
    });
    const salesmanId = resolveTransactionSalesmanId(
      explicitSalesmanId,
      company?.assignedSalesmanId,
    );
    const hasSalesman = Boolean(salesmanId);
    const payout = resolveTransactionPayoutOnWrite(
      amountCents,
      !!payoutOverride,
      payoutCentsFromBody(salesmanPayout),
      hasSalesman,
    );

    const row = await prisma.companyOneTimeTransaction.create({
      data: {
        companyId,
        projectId: projectId ?? null,
        salesmanId,
        title,
        description: description ?? null,
        category,
        amountCents,
        currency: currency.toUpperCase(),
        recognizedAt: new Date(recognizedAtRaw),
        paymentStatus,
        salesmanPayoutCents: payout.salesmanPayoutCents,
        salesmanPayoutOverride: payout.salesmanPayoutOverride,
        notes: notes ?? null,
      },
      include: includeRelations,
    });

    return created(res, stripCosts(serializeTransaction(row), req.user!));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    const existing = await getTransactionIfAccessible(req, id);
    const body = req.body;

    if (body.project_id !== undefined) {
      await assertProjectBelongsToCompany(body.project_id, existing.companyId);
    }

    const amountCents =
      body.amount !== undefined ? dollarsToCents(body.amount) : existing.amountCents;

    const company = await prisma.company.findUnique({
      where: { id: existing.companyId },
      select: { assignedSalesmanId: true },
    });
    const salesmanId =
      body.salesman_id !== undefined
        ? resolveTransactionSalesmanId(body.salesman_id, company?.assignedSalesmanId)
        : existing.salesmanId ??
          resolveTransactionSalesmanId(null, company?.assignedSalesmanId);
    const hasSalesman = Boolean(salesmanId);

    let payoutOverride = existing.salesmanPayoutOverride;
    if (body.salesman_payout_override !== undefined) {
      payoutOverride = !!body.salesman_payout_override;
    }

    let salesmanPayoutCents = existing.salesmanPayoutCents;
    if (!hasSalesman) {
      payoutOverride = false;
      salesmanPayoutCents = 0;
    } else if (body.salesman_payout !== undefined) {
      salesmanPayoutCents = payoutCentsFromBody(body.salesman_payout) ?? null;
      payoutOverride = true;
    } else if (body.amount !== undefined || body.salesman_payout_override === false) {
      if (!payoutOverride || body.salesman_payout_override === false) {
        payoutOverride = false;
        salesmanPayoutCents = computeDefaultPayoutCents(amountCents, true);
      }
    }

    const data: Prisma.CompanyOneTimeTransactionUpdateInput = {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.amount !== undefined && { amountCents }),
      ...(body.currency !== undefined && { currency: body.currency.toUpperCase() }),
      ...(body.recognized_at !== undefined && {
        recognizedAt: new Date(body.recognized_at),
      }),
      ...(body.payment_status !== undefined && { paymentStatus: body.payment_status }),
      ...(body.project_id !== undefined && { projectId: body.project_id }),
      ...(body.salesman_id !== undefined && { salesmanId }),
      ...(body.notes !== undefined && { notes: body.notes }),
      salesmanPayoutCents,
      salesmanPayoutOverride: payoutOverride,
    };

    const row = await prisma.companyOneTimeTransaction.update({
      where: { id },
      data,
      include: includeRelations,
    });

    return success(res, stripCosts(serializeTransaction(row), req.user!));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    await getTransactionIfAccessible(req, id);
    await prisma.companyOneTimeTransaction.delete({ where: { id } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function listExpenses(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin'); // contractor costs are admin-only
    const transaction = await getTransactionIfAccessible(req, getParam(req, 'id'));
    return success(res, transaction.expenses.map(serializeExpense));
  } catch (err) {
    next(err);
  }
}

export async function createExpense(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    assertRole(req.user!, 'admin'); // contractor costs are admin-only
    const transaction = await getTransactionIfAccessible(req, getParam(req, 'id'));
    const {
      name,
      vendor,
      expense_type: expenseType = 'contractor',
      amount,
      currency = transaction.currency,
      spent_at: spentAtRaw,
      notes,
    } = req.body;

    const row = await prisma.companyOneTimeTransactionExpense.create({
      data: {
        transactionId: transaction.id,
        name,
        vendor: vendor ?? null,
        expenseType,
        amountCents: dollarsToCents(amount),
        currency: String(currency).toUpperCase(),
        spentAt: spentAtRaw ? new Date(spentAtRaw) : null,
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
    assertRole(req.user!, 'admin'); // contractor costs are admin-only
    await getTransactionIfAccessible(req, getParam(req, 'id'));
    const expenseId = getParam(req, 'expenseId');
    const existing = await prisma.companyOneTimeTransactionExpense.findFirst({
      where: { id: expenseId, transactionId: getParam(req, 'id') },
    });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Expense not found', 404);

    const body = req.body;
    const row = await prisma.companyOneTimeTransactionExpense.update({
      where: { id: expenseId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.vendor !== undefined && { vendor: body.vendor ?? null }),
        ...(body.expense_type !== undefined && { expenseType: body.expense_type }),
        ...(body.amount !== undefined && { amountCents: dollarsToCents(body.amount) }),
        ...(body.currency !== undefined && { currency: body.currency.toUpperCase() }),
        ...(body.spent_at !== undefined && {
          spentAt: body.spent_at ? new Date(body.spent_at) : null,
        }),
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
    assertRole(req.user!, 'admin'); // contractor costs are admin-only
    await getTransactionIfAccessible(req, getParam(req, 'id'));
    const expenseId = getParam(req, 'expenseId');
    const existing = await prisma.companyOneTimeTransactionExpense.findFirst({
      where: { id: expenseId, transactionId: getParam(req, 'id') },
    });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Expense not found', 404);

    await prisma.companyOneTimeTransactionExpense.delete({ where: { id: expenseId } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
