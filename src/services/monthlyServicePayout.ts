import { prisma } from '../lib/prisma';
import { DEFAULT_SALESMAN_SPLIT_PERCENT } from '../validators/monthlyServices';

export function companyHasSalesman(
  company?: { assignedSalesman?: { id: string } | null } | null,
): boolean {
  return Boolean(company?.assignedSalesman?.id);
}

export function computeDefaultPayoutCents(
  monthlyAmountCents: number,
  hasSalesman: boolean,
): number {
  if (!hasSalesman) return 0;
  return Math.round(monthlyAmountCents * (DEFAULT_SALESMAN_SPLIT_PERCENT / 100));
}

export function defaultSalesmanSplitPercent(hasSalesman: boolean): number {
  return hasSalesman ? DEFAULT_SALESMAN_SPLIT_PERCENT : 0;
}

export function resolvePayoutOnWrite(
  monthlyAmountCents: number,
  override: boolean,
  explicitPayoutCents: number | null | undefined,
  hasSalesman: boolean,
): { salesmanPayoutCents: number | null; salesmanPayoutOverride: boolean } {
  if (!hasSalesman) {
    return { salesmanPayoutCents: 0, salesmanPayoutOverride: false };
  }
  if (override) {
    return {
      salesmanPayoutCents: explicitPayoutCents ?? null,
      salesmanPayoutOverride: true,
    };
  }
  return {
    salesmanPayoutCents: computeDefaultPayoutCents(monthlyAmountCents, true),
    salesmanPayoutOverride: false,
  };
}

/** Recalculate stored default payouts when a client's salesman assignment changes. */
export async function propagateCompanySalesmanToMonthlyServices(
  companyId: string,
  salesmanId: string | null,
) {
  const hasSalesman = Boolean(salesmanId);
  const services = await prisma.companyMonthlyService.findMany({
    where: { companyId },
    select: { id: true, monthlyAmountCents: true, salesmanPayoutOverride: true },
  });

  for (const service of services) {
    if (service.salesmanPayoutOverride && hasSalesman) continue;
    await prisma.companyMonthlyService.update({
      where: { id: service.id },
      data: {
        salesmanPayoutCents: computeDefaultPayoutCents(service.monthlyAmountCents, hasSalesman),
        salesmanPayoutOverride: false,
      },
    });
  }
}
