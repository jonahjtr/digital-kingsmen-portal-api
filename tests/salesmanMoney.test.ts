import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

/** Sales sees every client, but only their own deals' money and never contractor costs or net. */
const app = createApp();
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'Demo123!' })).body.data.accessToken as string;

describe('salesman money visibility', () => {
  let admin: string, sales: string, mineId: string, otherId: string;

  beforeAll(async () => {
    admin = await login('admin@digitalkingsmen.com');
    sales = await login('salesman@digitalkingsmen.com');
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'salesman@digitalkingsmen.com' } });
    const [mine, other] = await Promise.all([
      prisma.company.create({ data: { name: 'Sold By Me Co', assignedSalesmanId: me.id } }),
      prisma.company.create({ data: { name: 'Not My Deal Co' } }),
    ]);
    const mk = (companyId: string) =>
      prisma.companyMonthlyService.create({
        data: {
          companyId, serviceCategory: 'seo', monthlyAmountCents: 120000, status: 'active',
          expenses: { create: { name: 'SEO team', vendor: 'SEO team', expenseType: 'contractor', amountCents: 25000, isRecurring: true } },
        },
      });
    mineId = (await mk(mine.id)).id;
    otherId = (await mk(other.id)).id;
  });

  it('sees every client, including ones they did not sell', async () => {
    const r = await request(app).get('/api/companies?limit=200').set('Authorization', `Bearer ${sales}`);
    const names = (r.body.data as { name: string }[]).map((c) => c.name);
    expect(names).toContain('Not My Deal Co');
  });

  it('revenue list = only their deals, with no contractor cost or net', async () => {
    const r = await request(app).get('/api/monthly-services').set('Authorization', `Bearer ${sales}`);
    const ids = (r.body.data as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(mineId);
    expect(ids).not.toContain(otherId);
    const row = r.body.data.find((x: { id: string }) => x.id === mineId);
    expect(row.monthlyAmount).toBe(1200);
    expect(row.salesmanPayout).toBeGreaterThan(0);
    for (const k of ['expenses', 'totalExpenses', 'totalExpensesCents', 'netAmount']) expect(row).not.toHaveProperty(k);
    expect(JSON.stringify(r.body)).not.toContain('SEO team');
  });

  it('cannot read or edit contractor costs, even on their own deal', async () => {
    const r = await request(app).get(`/api/monthly-services/${mineId}/expenses`).set('Authorization', `Bearer ${sales}`);
    expect(r.status).toBe(403);
    const w = await request(app).post(`/api/monthly-services/${mineId}/expenses`).set('Authorization', `Bearer ${sales}`)
      .send({ name: 'x', expense_type: 'contractor', amount: 1 });
    expect(w.status).toBe(403);
  });

  it('cannot touch another rep\'s deal or company totals', async () => {
    const r = await request(app).patch(`/api/monthly-services/${otherId}`).set('Authorization', `Bearer ${sales}`).send({ status: 'paused' });
    expect(r.status).toBe(404);
    const f = await request(app).get('/api/business-finance/summary').set('Authorization', `Bearer ${sales}`);
    expect(f.status).toBe(403);
  });

  it('admin still sees everything', async () => {
    const r = await request(app).get('/api/monthly-services').set('Authorization', `Bearer ${admin}`);
    const row = r.body.data.find((x: { id: string }) => x.id === otherId);
    expect(row.totalExpenses).toBe(250);
    expect(row).toHaveProperty('netAmount');
  });
});
