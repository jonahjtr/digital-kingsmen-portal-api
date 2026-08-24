import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

async function login(email: string): Promise<string | null> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'Demo123!' });
  if (res.status !== 200) return null;
  return res.body.data.accessToken;
}

describe('One-time transactions', () => {
  it('recognizes revenue only in the month of recognized_at', async () => {
    const token = await login('admin@digitalkingsmen.com');
    if (!token) return;

    const companies = await request(app)
      .get('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 1 });
    const companyId = companies.body.data?.[0]?.id;
    if (!companyId) return;

    const title = `Website build ${Date.now()}`;
    const create = await request(app)
      .post(`/api/companies/${companyId}/one-time-transactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title,
        category: 'website',
        amount: 5000,
        recognized_at: '2026-06-15T12:00:00.000Z',
        payment_status: 'paid',
      });

    expect(create.status).toBe(201);
    expect(create.body.success).toBe(true);
    expect(create.body.data.amount).toBe(5000);
    expect(create.body.data.salesmanPayout).toBe(1500);

    const transactionId = create.body.data.id;

    const june = await request(app)
      .get('/api/one-time-transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ month: '2026-06', company_id: companyId });
    expect(june.status).toBe(200);
    expect(june.body.data.some((row: { id: string }) => row.id === transactionId)).toBe(true);

    const july = await request(app)
      .get('/api/one-time-transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ month: '2026-07', company_id: companyId });
    expect(july.status).toBe(200);
    expect(july.body.data.some((row: { id: string }) => row.id === transactionId)).toBe(false);

    const summary = await request(app)
      .get('/api/business-finance/summary')
      .set('Authorization', `Bearer ${token}`)
      .query({ month: '2026-06' });
    expect(summary.status).toBe(200);
    expect(summary.body.data.totals.oneTimeRevenue).toBeGreaterThanOrEqual(5000);
  });

  it('tracks contractor spend and salesman payout on one-time transactions', async () => {
    const token = await login('admin@digitalkingsmen.com');
    if (!token) return;

    const companies = await request(app)
      .get('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 1 });
    const companyId = companies.body.data?.[0]?.id;
    if (!companyId) return;

    const create = await request(app)
      .post(`/api/companies/${companyId}/one-time-transactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: `Branding package ${Date.now()}`,
        category: 'branding',
        amount: 2000,
        recognized_at: '2026-06-20T12:00:00.000Z',
      });

    expect(create.status).toBe(201);
    const transactionId = create.body.data.id;

    const expense = await request(app)
      .post(`/api/one-time-transactions/${transactionId}/expenses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Freelance designer',
        expense_type: 'contractor',
        amount: 600,
      });

    expect(expense.status).toBe(201);
    expect(expense.body.data.amount).toBe(600);

    const refreshed = await request(app)
      .get('/api/one-time-transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ month: '2026-06', company_id: companyId });
    const row = refreshed.body.data.find((item: { id: string }) => item.id === transactionId);
    expect(row).toBeTruthy();
    expect(row.totalExpenses).toBe(600);
    expect(row.netAmount).toBe(2000 - 600 - (row.salesmanPayout ?? 0));
  });

  it('can link a one-time transaction to a project without changing recognition month', async () => {
    const token = await login('admin@digitalkingsmen.com');
    if (!token) return;

    const companies = await request(app)
      .get('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 1 });
    const companyId = companies.body.data?.[0]?.id;
    if (!companyId) return;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_id: companyId,
        name: `Website project ${Date.now()}`,
        status: 'in_progress',
        start_date: '2026-06-01T00:00:00.000Z',
        due_date: '2026-08-01T00:00:00.000Z',
      });
    expect(project.status).toBe(201);
    const projectId = project.body.data.id;

    const create = await request(app)
      .post(`/api/companies/${companyId}/one-time-transactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Website sold in June',
        category: 'website',
        amount: 5000,
        project_id: projectId,
        recognized_at: '2026-06-10T12:00:00.000Z',
      });

    expect(create.status).toBe(201);
    expect(create.body.data.projectId).toBe(projectId);

    const august = await request(app)
      .get('/api/one-time-transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ month: '2026-08', project_id: projectId });
    expect(august.body.data.some((row: { id: string }) => row.id === create.body.data.id)).toBe(
      false,
    );
  });

  it('blocks client users from creating one-time transactions', async () => {
    const token = await login('client-pure@example.com');
    if (!token) return;

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    const companyId = me.body.data?.companyUsers?.[0]?.company?.id;
    if (!companyId) return;

    const create = await request(app)
      .post(`/api/companies/${companyId}/one-time-transactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Should fail',
        amount: 100,
        recognized_at: '2026-06-01T12:00:00.000Z',
      });

    expect(create.status).toBe(403);
  });
});
