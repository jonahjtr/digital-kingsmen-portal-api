/**
 * Who can see which money.
 *  - Admin: everything (all pricing, contractor costs, net profit, company totals).
 *  - Salesman: price + their own split, ONLY on deals they sold. Never contractor costs or net.
 *  - Employee/contractor: pricing for clients they work on, never contractor costs or net.
 * Every money endpoint goes through these helpers — change the rules here, nowhere else.
 */
import type { Prisma, User } from '@prisma/client';
import { companyWhereForUser } from './filters';

export const canSeeContractorCosts = (user: Pick<User, 'role'>) => user.role === 'admin';

export async function monthlyServiceMoneyScope(user: User): Promise<Prisma.CompanyMonthlyServiceWhereInput> {
  if (user.role === 'admin') return {};
  if (user.role === 'salesman') return { company: { assignedSalesmanId: user.id } };
  return { company: await companyWhereForUser(user) };
}

export async function oneTimeMoneyScope(user: User): Promise<Prisma.CompanyOneTimeTransactionWhereInput> {
  if (user.role === 'admin') return {};
  if (user.role === 'salesman') {
    return { OR: [{ salesmanId: user.id }, { salesmanId: null, company: { assignedSalesmanId: user.id } }] };
  }
  return { company: await companyWhereForUser(user) };
}

/** Remove contractor costs + derived net from a serialized money row for non-admins. */
export function stripCosts<T extends Record<string, unknown>>(row: T, user: Pick<User, 'role'>): T {
  if (canSeeContractorCosts(user)) return row;
  const { expenses: _e, totalExpenses: _t, totalExpensesCents: _tc, netAmount: _n, netAmountCents: _nc, ...rest } = row;
  return rest as T;
}
