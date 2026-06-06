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

describe('Salesman company create flow', () => {
  it('salesman can scan a website before creating a client', async () => {
    const token = await login('salesman@digitalkingsmen.com');
    if (!token) return;

    const res = await request(app)
      .post('/api/companies/enrich-preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ website: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.website).toBeDefined();
  });

  it('salesman can create a client and is auto-assigned as sales rep', async () => {
    const token = await login('salesman@digitalkingsmen.com');
    if (!token) return;

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    const salesmanId = me.body.data?.id;
    if (!salesmanId) return;

    const name = `Salesman Flow Client ${Date.now()}`;
    const create = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        website: 'https://example.com',
        enrichment_applied: true,
        enrichment_source: 'website',
        enrichment_snapshot: JSON.stringify({
          website: 'https://example.com',
          field_confidence: { website: 'high' },
          warnings: [],
        }),
      });

    expect(create.status).toBe(201);
    expect(create.body.success).toBe(true);
    expect(create.body.data.name).toBe(name);
    expect(create.body.data.assignedSalesman?.id).toBe(salesmanId);

    const companyId = create.body.data.id;
    const update = await request(app)
      .patch(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ industry: 'Test industry' });

    expect(update.status).toBe(200);
    expect(update.body.data.industry).toBe('Test industry');
  });
});
