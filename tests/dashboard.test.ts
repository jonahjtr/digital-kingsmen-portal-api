import { describe, it, expect, beforeAll } from 'vitest';
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

describe('Dashboard API', () => {
  let adminToken: string | null;

  beforeAll(async () => {
    adminToken = await login('admin@digitalkingsmen.com');
  });

  it('admin dashboard returns UI-shaped payload', async () => {
    if (!adminToken) return;

    const res = await request(app)
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.stats).toBeDefined();
    expect(typeof data.stats.activeProjects).toBe('number');
    expect(typeof data.stats.waitingOnClient).toBe('number');
    expect(typeof data.stats.pendingApprovals).toBe('number');
    expect(typeof data.stats.unreadMessages).toBe('number');
    expect(Array.isArray(data.projects)).toBe(true);
    expect(Array.isArray(data.recentUpdates)).toBe(true);
    expect(Array.isArray(data.upcomingDeadlines)).toBe(true);

    if (data.projects.length > 0) {
      expect(data.projects[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        status: expect.any(String),
        progress: expect.any(Number),
      });
    }

    if (data.recentUpdates.length > 0) {
      expect(data.recentUpdates[0].body).toBeDefined();
      expect(data.recentUpdates[0].createdAt).toBeDefined();
    }

    if (data.upcomingDeadlines.length > 0) {
      expect(data.upcomingDeadlines[0].title).toBeDefined();
    }
  });
});
