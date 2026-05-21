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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Company logo API', () => {
  it('admin can upload, fetch, and delete company logo', async () => {
    const token = await login('admin@digitalkingsmen.com');
    if (!token) return;

    const companies = await request(app)
      .get('/api/companies')
      .set('Authorization', `Bearer ${token}`);
    expect(companies.status).toBe(200);
    const companyId = companies.body.data?.[0]?.id;
    if (!companyId) return;

    await request(app)
      .delete(`/api/companies/${companyId}/logo`)
      .set('Authorization', `Bearer ${token}`);

    const upload = await request(app)
      .post(`/api/companies/${companyId}/logo`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PNG_1X1, { filename: 'logo.png', contentType: 'image/png' });

    expect(upload.status).toBe(200);
    expect(upload.body.data.hasLogo).toBe(true);

    const logo = await request(app)
      .get(`/api/companies/${companyId}/logo`)
      .set('Authorization', `Bearer ${token}`);
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toMatch(/image\//);

    const getCompany = await request(app)
      .get(`/api/companies/${companyId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getCompany.body.data.hasLogo).toBe(true);

    const removed = await request(app)
      .delete(`/api/companies/${companyId}/logo`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.hasLogo).toBe(false);

    const missing = await request(app)
      .get(`/api/companies/${companyId}/logo`)
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  it('salesman cannot upload company logo', async () => {
    const adminToken = await login('admin@digitalkingsmen.com');
    const salesmanToken = await login('salesman@digitalkingsmen.com');
    if (!adminToken || !salesmanToken) return;

    const companies = await request(app)
      .get('/api/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    const companyId = companies.body.data?.[0]?.id;
    if (!companyId) return;

    const res = await request(app)
      .post(`/api/companies/${companyId}/logo`)
      .set('Authorization', `Bearer ${salesmanToken}`)
      .attach('file', PNG_1X1, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
  });
});
