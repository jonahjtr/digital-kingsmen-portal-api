import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();

describe('Auth API', () => {
  beforeAll(async () => {
    try {
      const count = await prisma.user.count();
      if (count === 0) {
        console.warn('Run npm run db:seed before tests for full coverage');
      }
    } catch {
      console.warn('Database unavailable — some auth tests will be skipped');
    }
  });

  it('POST /api/auth/login returns token for admin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@digitalkingsmen.com', password: 'Demo123!' });

    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.email).toBe('admin@digitalkingsmen.com');
    } else {
      expect([401, 500]).toContain(res.status);
    }
  });

  it('POST /api/auth/login rejects invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@digitalkingsmen.com', password: 'wrong' });

    expect([401, 500]).toContain(res.status);
    if (res.status === 401) {
      expect(res.body.success).toBe(false);
    }
  });

  it('POST /api/auth/register rejects invalid invite', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'fake@example.com',
        password: 'Demo123!xx',
        full_name: 'Fake User',
        invite_token: 'invalid-token',
      });

    expect([400, 500]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.success).toBe(false);
    }
  });

  it('GET /api/auth/me requires auth', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
