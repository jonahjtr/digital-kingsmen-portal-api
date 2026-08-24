import {
  computeDefaultPayoutCents,
  defaultSalesmanSplitPercent,
  resolvePayoutOnWrite,
} from './monthlyServicePayout';

export function transactionHasSalesman(
  salesman?: { id: string } | null,
): boolean {
  return Boolean(salesman?.id);
}

export function resolveTransactionSalesmanId(
  explicitSalesmanId: string | null | undefined,
  companyAssignedSalesmanId: string | null | undefined,
): string | null {
  return explicitSalesmanId ?? companyAssignedSalesmanId ?? null;
}

export function resolveTransactionPayoutOnWrite(
  amountCents: number,
  override: boolean,
  explicitPayoutCents: number | null | undefined,
  hasSalesman: boolean,
) {
  return resolvePayoutOnWrite(amountCents, override, explicitPayoutCents, hasSalesman);
}

export {
  computeDefaultPayoutCents,
  defaultSalesmanSplitPercent,
};
