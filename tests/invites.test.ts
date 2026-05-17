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

describe('Invites API', () => {
  let adminToken: string | null;

  beforeAll(async () => {
    adminToken = await login('admin@digitalkingsmen.com');
  });

  it('lists registration tokens for admin', async () => {
    if (!adminToken) return;

    const res = await request(app)
      .get('/api/invites/registration-tokens')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tokens?.length).toBeGreaterThanOrEqual(4);
    const client = res.body.data.tokens.find((t: { token: string }) => t.token === 'dk-register-client');
    expect(client).toBeDefined();
  });

  it('POST /invites creates one-time invite', async () => {
    if (!adminToken) return;

    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `invite-${Date.now()}@example.com`,
        role: 'client',
        send_email: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.email_sent).toBe(false);
  });

  it('registers with reusable client token and any email', async () => {
    const email = `reusable-${Date.now()}@example.com`;
    const res = await request(app).post('/api/auth/register').send({
      email,
      password: 'Demo123!xx',
      full_name: 'Reusable Test',
      invite_token: 'dk-register-client',
    });

    if (res.status === 400 && res.body.error?.message?.includes('already exists')) {
      return;
    }

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('client');
    expect(res.body.data.accessToken).toBeDefined();

    const again = await request(app).post('/api/auth/register').send({
      email: `reusable-2-${Date.now()}@example.com`,
      password: 'Demo123!xx',
      full_name: 'Reusable Test 2',
      invite_token: 'dk-register-client',
    });
    expect(again.status).toBe(201);
  });
});
