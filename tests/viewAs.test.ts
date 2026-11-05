import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'Demo123!' })).body.data.accessToken as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('admin view-as', () => {
  let admin: string, sales: string, clientId: string, adminId: string, view: string;

  beforeAll(async () => {
    admin = await login('admin@digitalkingsmen.com');
    sales = await login('salesman@digitalkingsmen.com');
    clientId = (await prisma.user.findUniqueOrThrow({ where: { email: 'client-pure@example.com' } })).id;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@digitalkingsmen.com' } })).id;
  });

  it('only admins can start it, and never as another admin', async () => {
    expect((await request(app).post(`/api/auth/view-as/${clientId}`).set(as(sales))).status).toBe(403);
    expect((await request(app).post(`/api/auth/view-as/${adminId}`).set(as(admin))).status).toBe(403);
  });

  it('acts exactly as the user and /me names the real admin', async () => {
    const r = await request(app).post(`/api/auth/view-as/${clientId}`).set(as(admin));
    expect(r.status).toBe(200);
    view = r.body.data.accessToken;
    const me = await request(app).get('/api/auth/me').set(as(view));
    expect(me.body.data.email).toBe('client-pure@example.com');
    expect(me.body.data.impersonator.email).toBe('admin@digitalkingsmen.com');
    // client-only scoping applies — admin-only area is refused
    expect((await request(app).get('/api/business-finance/summary').set(as(view))).status).toBe(403);
  });

  it('cannot nest, edit accounts or mint MCP keys while viewing as', async () => {
    const other = (await prisma.user.findUniqueOrThrow({ where: { email: 'client-four@example.com' } })).id;
    expect((await request(app).post(`/api/auth/view-as/${other}`).set(as(view))).status).toBe(403);
    expect((await request(app).patch(`/api/users/${clientId}`).set(as(view)).send({ full_name: 'x' })).status).toBe(403);
    expect((await request(app).get('/api/mcp-tokens').set(as(view))).status).toBe(403);
  });

  it('dies immediately if the admin loses admin', async () => {
    await prisma.user.update({ where: { id: adminId }, data: { role: 'employee' } });
    try {
      expect((await request(app).get('/api/auth/me').set(as(view))).status).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: adminId }, data: { role: 'admin' } });
    }
  });
});
