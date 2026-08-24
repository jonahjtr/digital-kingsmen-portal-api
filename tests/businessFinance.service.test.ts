import { describe, it, expect, beforeAll } from 'vitest';
import { getPrisma } from '../src/lib/prisma';
import { buildBusinessFinanceSummary } from '../src/services/businessFinance.service';

const prisma = getPrisma();

describe('buildBusinessFinanceSummary', () => {
  beforeAll(async () => {
    const company = await prisma.company.findFirst({
      select: { id: true, assignedSalesmanId: true },
    });
    if (!company) return;

    await prisma.companyOneTimeTransaction.create({
      data: {
        companyId: company.id,
        title: `Finance summary test ${Date.now()}`,
        category: 'website',
        amountCents: 750_000,
        recognizedAt: new Date('2026-06-18T12:00:00.000Z'),
        paymentStatus: 'paid',
        salesmanId: company.assignedSalesmanId,
        salesmanPayoutCents: 225_000,
        salesmanPayoutOverride: true,
        expenses: {
          create: {
            name: 'Contract dev',
            expenseType: 'contractor',
            amountCents: 100_000,
          },
        },
      },
    });
  });

  it('includes one-time revenue in the selected month summary', async () => {
    const summary = await buildBusinessFinanceSummary('2026-06');
    expect(summary.totals.oneTimeRevenue).toBeGreaterThanOrEqual(7500);
    expect(summary.totals.oneTimeLineCount).toBeGreaterThanOrEqual(1);
    expect(summary.services.some((service) => (service.oneTimeRevenue ?? 0) > 0)).toBe(true);
  });
});
