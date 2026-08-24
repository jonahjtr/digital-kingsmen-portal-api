import { MonthlyServiceStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { parseMonthRange } from '../lib/monthRange';
import { BILLABLE_REVENUE_CATEGORIES } from '../validators/monthlyServices';
import {
  companyHasSalesman,
  computeDefaultPayoutCents,
} from './monthlyServicePayout';
import { transactionHasSalesman } from './oneTimeTransactionPayout';

function centsToDollars(cents: number): number {
  return cents / 100;
}

function effectiveMonthlyPayoutCents(row: {
  monthlyAmountCents: number;
  salesmanPayoutCents: number | null;
  salesmanPayoutOverride: boolean;
  company?: { assignedSalesman?: { id: string } | null } | null;
}): number {
  const hasSalesman = companyHasSalesman(row.company);
  if (!hasSalesman) return 0;
  if (row.salesmanPayoutOverride && row.salesmanPayoutCents != null) {
    return row.salesmanPayoutCents;
  }
  return computeDefaultPayoutCents(row.monthlyAmountCents, true);
}

function effectiveOneTimePayoutCents(row: {
  amountCents: number;
  salesmanPayoutCents: number | null;
  salesmanPayoutOverride: boolean;
  salesman?: { id: string } | null;
  company?: { assignedSalesman?: { id: string } | null } | null;
}): number {
  const effectiveSalesman = row.salesman ?? row.company?.assignedSalesman ?? null;
  const hasSalesman = transactionHasSalesman(effectiveSalesman);
  if (!hasSalesman) return 0;
  if (row.salesmanPayoutOverride && row.salesmanPayoutCents != null) {
    return row.salesmanPayoutCents;
  }
  return computeDefaultPayoutCents(row.amountCents, true);
}

export async function buildBusinessFinanceSummary(month?: string) {
  const { start, end, monthKey } = parseMonthRange(month);

  const [monthlyServices, oneTimeTransactions, businessRecurringExpenses] = await Promise.all([
    prisma.companyMonthlyService.findMany({
      where: {
        status: MonthlyServiceStatus.active,
        serviceCategory: { in: [...BILLABLE_REVENUE_CATEGORIES] },
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            assignedSalesman: { select: { id: true, fullName: true, email: true } },
          },
        },
        expenses: true,
      },
    }),
    prisma.companyOneTimeTransaction.findMany({
      where: {
        recognizedAt: { gte: start, lt: end },
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            assignedSalesman: { select: { id: true, fullName: true, email: true } },
          },
        },
        salesman: { select: { id: true, fullName: true, email: true } },
        expenses: true,
      },
    }),
    prisma.businessRecurringExpense.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
  ]);

  type SalesmanAgg = {
    id: string;
    fullName?: string | null;
    email?: string | null;
    revenueCents: number;
    payoutCents: number;
    oneTimeRevenueCents: number;
    oneTimePayoutCents: number;
  };

  type ContractorAgg = {
    name: string;
    vendor?: string | null;
    amountCents: number;
    lineCount: number;
  };

  const serviceMap = new Map<
    string,
    {
      serviceCategory: string;
      revenueCents: number;
      oneTimeRevenueCents: number;
      salesmanPayoutCents: number;
      oneTimePayoutCents: number;
      serviceExpenseCents: number;
      oneTimeExpenseCents: number;
      businessOverheadCents: number;
      activeLineCount: number;
      oneTimeLineCount: number;
      clientIds: Set<string>;
      salesmen: Map<string, SalesmanAgg>;
      contractors: Map<string, ContractorAgg>;
    }
  >();

  const ensureService = (category: string) => {
    if (!serviceMap.has(category)) {
      serviceMap.set(category, {
        serviceCategory: category,
        revenueCents: 0,
        oneTimeRevenueCents: 0,
        salesmanPayoutCents: 0,
        oneTimePayoutCents: 0,
        serviceExpenseCents: 0,
        oneTimeExpenseCents: 0,
        businessOverheadCents: 0,
        activeLineCount: 0,
        oneTimeLineCount: 0,
        clientIds: new Set(),
        salesmen: new Map(),
        contractors: new Map(),
      });
    }
    return serviceMap.get(category)!;
  };

  const addSalesman = (
    bucket: ReturnType<typeof ensureService>,
    salesman: { id: string; fullName?: string | null; email?: string | null } | null | undefined,
    revenueCents: number,
    payoutCents: number,
    isOneTime: boolean,
  ) => {
    if (!salesman?.id) return;
    const existing = bucket.salesmen.get(salesman.id) ?? {
      id: salesman.id,
      fullName: salesman.fullName,
      email: salesman.email,
      revenueCents: 0,
      payoutCents: 0,
      oneTimeRevenueCents: 0,
      oneTimePayoutCents: 0,
    };
    if (isOneTime) {
      existing.oneTimeRevenueCents += revenueCents;
      existing.oneTimePayoutCents += payoutCents;
    } else {
      existing.revenueCents += revenueCents;
      existing.payoutCents += payoutCents;
    }
    bucket.salesmen.set(salesman.id, existing);
  };

  const addContractor = (
    bucket: ReturnType<typeof ensureService>,
    name: string,
    vendor: string | null | undefined,
    amountCents: number,
  ) => {
    const key = `${name}::${vendor ?? ''}`;
    const existing = bucket.contractors.get(key) ?? {
      name,
      vendor: vendor ?? null,
      amountCents: 0,
      lineCount: 0,
    };
    existing.amountCents += amountCents;
    existing.lineCount += 1;
    bucket.contractors.set(key, existing);
  };

  let recurringRevenueCents = 0;
  let oneTimeRevenueCents = 0;
  let recurringPayoutCents = 0;
  let oneTimePayoutCents = 0;
  let recurringServiceExpenseCents = 0;
  let oneTimeExpenseCents = 0;

  for (const row of monthlyServices) {
    const bucket = ensureService(row.serviceCategory);
    const payout = effectiveMonthlyPayoutCents(row);
    const recurringExpenses = row.expenses
      .filter((e) => e.isRecurring)
      .reduce((sum, e) => sum + e.amountCents, 0);

    bucket.revenueCents += row.monthlyAmountCents;
    bucket.salesmanPayoutCents += payout;
    bucket.serviceExpenseCents += recurringExpenses;
    bucket.activeLineCount += 1;
    bucket.clientIds.add(row.companyId);

    recurringRevenueCents += row.monthlyAmountCents;
    recurringPayoutCents += payout;
    recurringServiceExpenseCents += recurringExpenses;

    addSalesman(bucket, row.company.assignedSalesman, row.monthlyAmountCents, payout, false);
    for (const expense of row.expenses.filter((e) => e.isRecurring)) {
      addContractor(bucket, expense.name, expense.vendor, expense.amountCents);
    }
  }

  for (const row of oneTimeTransactions) {
    const category =
      row.category === 'website' || row.category === 'branding'
        ? row.category
        : 'other';
    const bucket = ensureService(category);
    const payout = effectiveOneTimePayoutCents(row);
    const expenseTotal = row.expenses.reduce((sum, e) => sum + e.amountCents, 0);
    const effectiveSalesman = row.salesman ?? row.company.assignedSalesman ?? null;

    bucket.oneTimeRevenueCents += row.amountCents;
    bucket.oneTimePayoutCents += payout;
    bucket.oneTimeExpenseCents += expenseTotal;
    bucket.oneTimeLineCount += 1;
    bucket.clientIds.add(row.companyId);

    oneTimeRevenueCents += row.amountCents;
    oneTimePayoutCents += payout;
    oneTimeExpenseCents += expenseTotal;

    addSalesman(bucket, effectiveSalesman, row.amountCents, payout, true);
    for (const expense of row.expenses) {
      addContractor(bucket, expense.name, expense.vendor, expense.amountCents);
    }
  }

  const activeBusinessExpenses = businessRecurringExpenses.filter((e) => e.isActive);
  const businessOverheadCents = activeBusinessExpenses.reduce(
    (sum, e) => sum + e.amountCents,
    0,
  );

  for (const expense of activeBusinessExpenses) {
    const category = expense.serviceCategory ?? 'other';
    const bucket = ensureService(category);
    bucket.businessOverheadCents += expense.amountCents;
  }

  const services = [...serviceMap.values()]
    .map((bucket) => {
      const totalRevenueCents = bucket.revenueCents + bucket.oneTimeRevenueCents;
      const totalPayoutCents = bucket.salesmanPayoutCents + bucket.oneTimePayoutCents;
      const totalSpendCents =
        totalPayoutCents +
        bucket.serviceExpenseCents +
        bucket.oneTimeExpenseCents +
        bucket.businessOverheadCents;
      const netContributionCents = totalRevenueCents - totalSpendCents;

      return {
        serviceCategory: bucket.serviceCategory,
        revenueCents: bucket.revenueCents,
        revenue: centsToDollars(bucket.revenueCents),
        oneTimeRevenueCents: bucket.oneTimeRevenueCents,
        oneTimeRevenue: centsToDollars(bucket.oneTimeRevenueCents),
        totalRevenueCents,
        totalRevenue: centsToDollars(totalRevenueCents),
        salesmanPayoutCents: bucket.salesmanPayoutCents,
        salesmanPayout: centsToDollars(bucket.salesmanPayoutCents),
        oneTimePayoutCents: bucket.oneTimePayoutCents,
        oneTimePayout: centsToDollars(bucket.oneTimePayoutCents),
        serviceExpenseCents: bucket.serviceExpenseCents + bucket.oneTimeExpenseCents,
        serviceExpenses: centsToDollars(bucket.serviceExpenseCents + bucket.oneTimeExpenseCents),
        businessOverheadCents: bucket.businessOverheadCents,
        businessOverhead: centsToDollars(bucket.businessOverheadCents),
        totalSpendCents,
        totalSpend: centsToDollars(totalSpendCents),
        netContributionCents,
        netContribution: centsToDollars(netContributionCents),
        activeLineCount: bucket.activeLineCount,
        oneTimeLineCount: bucket.oneTimeLineCount,
        clientCount: bucket.clientIds.size,
        salesmen: [...bucket.salesmen.values()].map((salesman) => ({
          id: salesman.id,
          fullName: salesman.fullName,
          email: salesman.email,
          revenueCents: salesman.revenueCents + salesman.oneTimeRevenueCents,
          revenue: centsToDollars(salesman.revenueCents + salesman.oneTimeRevenueCents),
          payoutCents: salesman.payoutCents + salesman.oneTimePayoutCents,
          payout: centsToDollars(salesman.payoutCents + salesman.oneTimePayoutCents),
          recurringRevenueCents: salesman.revenueCents,
          recurringRevenue: centsToDollars(salesman.revenueCents),
          oneTimeRevenueCents: salesman.oneTimeRevenueCents,
          oneTimeRevenue: centsToDollars(salesman.oneTimeRevenueCents),
        })),
        contractors: [...bucket.contractors.values()].map((contractor) => ({
          name: contractor.name,
          vendor: contractor.vendor,
          amountCents: contractor.amountCents,
          amount: centsToDollars(contractor.amountCents),
          lineCount: contractor.lineCount,
        })),
      };
    })
    .sort((a, b) => a.serviceCategory.localeCompare(b.serviceCategory));

  const totalRevenueCents = recurringRevenueCents + oneTimeRevenueCents;
  const serviceLinkedSpendCents =
    recurringPayoutCents + oneTimePayoutCents + recurringServiceExpenseCents + oneTimeExpenseCents;
  const totalSpendCents = serviceLinkedSpendCents + businessOverheadCents;
  const netContributionCents = totalRevenueCents - totalSpendCents;

  return {
    month: monthKey,
    totals: {
      recurringRevenueCents,
      recurringRevenue: centsToDollars(recurringRevenueCents),
      oneTimeRevenueCents,
      oneTimeRevenue: centsToDollars(oneTimeRevenueCents),
      totalRevenueCents,
      totalRevenue: centsToDollars(totalRevenueCents),
      serviceLinkedSpendCents,
      serviceLinkedSpend: centsToDollars(serviceLinkedSpendCents),
      businessOverheadCents,
      businessOverhead: centsToDollars(businessOverheadCents),
      totalSpendCents,
      totalSpend: centsToDollars(totalSpendCents),
      netContributionCents,
      netContribution: centsToDollars(netContributionCents),
      activeLineCount: monthlyServices.length,
      oneTimeLineCount: oneTimeTransactions.length,
      serviceCategoryCount: services.length,
    },
    services,
    businessRecurringExpenses: businessRecurringExpenses.map((row) => ({
      id: row.id,
      name: row.name,
      vendor: row.vendor,
      expenseType: row.expenseType,
      amountCents: row.amountCents,
      amount: centsToDollars(row.amountCents),
      currency: row.currency,
      isActive: row.isActive,
      serviceCategory: row.serviceCategory,
      startedAt: row.startedAt,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  };
}
