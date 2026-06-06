import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { ConversationType } from '@prisma/client';
import { createApp } from '../src/app';
import { getPrisma } from '../src/lib/prisma';

const app = createApp();

async function login(email: string): Promise<string | null> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'Demo123!' });
  if (res.status !== 200) return null;
  return res.body.data.accessToken;
}

describe('Conversations unread (per-user)', () => {
  let pmToken: string | null;
  let clientToken: string | null;
  let conversationId: string | null;

  beforeAll(async () => {
    pmToken = await login('pm@digitalkingsmen.com');
    clientToken = await login('client-pure@example.com');
    if (!pmToken) return;

    const listRes = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${pmToken}`);
    const clientProject = (listRes.body.data as Array<{ id: string; type: string }>).find(
      (c) => c.type === 'client_project',
    );
    conversationId = clientProject?.id ?? null;
  });

  it('incoming message increments unread for recipient only', async () => {
    if (!pmToken || !clientToken || !conversationId) return;

    await request(app)
      .patch(`/api/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${clientToken}`);

    const sendRes = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ message: `Unread test ${Date.now()}` });
    expect(sendRes.status).toBe(201);

    const clientList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientList.status).toBe(200);
    const clientRow = (clientList.body.data as Array<{ id: string; unreadCount: number }>).find(
      (c) => c.id === conversationId,
    );
    expect(clientRow?.unreadCount).toBeGreaterThanOrEqual(1);

    const pmList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${pmToken}`);
    const pmRow = (pmList.body.data as Array<{ id: string; unreadCount: number }>).find(
      (c) => c.id === conversationId,
    );
    expect(pmRow?.unreadCount ?? 0).toBe(0);
  });

  it('mark conversation read clears unread for that user', async () => {
    if (!clientToken || !conversationId) return;

    const readRes = await request(app)
      .patch(`/api/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(readRes.status).toBe(200);

    const clientList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${clientToken}`);
    const clientRow = (clientList.body.data as Array<{ id: string; unreadCount: number }>).find(
      (c) => c.id === conversationId,
    );
    expect(clientRow?.unreadCount ?? 0).toBe(0);
  });

  it('client unread excludes internal-only messages', async () => {
    if (!pmToken || !clientToken || !conversationId) return;

    await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ message: `Internal only ${Date.now()}`, internal_only: true });

    const clientList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${clientToken}`);
    const beforeRead = (clientList.body.data as Array<{ id: string; unreadCount: number }>).find(
      (c) => c.id === conversationId,
    );
    const unreadBefore = beforeRead?.unreadCount ?? 0;

    await request(app)
      .patch(`/api/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${clientToken}`);

    const afterInternal = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ message: `Another internal ${Date.now()}`, internal_only: true });

    expect(afterInternal.status).toBe(201);

    const clientList2 = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${clientToken}`);
    const clientRow = (clientList2.body.data as Array<{ id: string; unreadCount: number }>).find(
      (c) => c.id === conversationId,
    );
    expect(clientRow?.unreadCount ?? 0).toBe(unreadBefore);
  });
});

describe('Unified project conversations', () => {
  let adminToken: string | null;
  let salesmanToken: string | null;
  let clientToken: string | null;
  let projectId: string | null;

  beforeAll(async () => {
    adminToken = await login('admin@digitalkingsmen.com');
    salesmanToken = await login('salesman@digitalkingsmen.com');
    clientToken = await login('client-pure@example.com');
    if (!adminToken) return;

    const projectsRes = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`);
    projectId = (projectsRes.body.data as Array<{ id: string }>)[0]?.id ?? null;
  });

  it('includes salesman on client_project thread when opening unified conversation', async () => {
    if (!adminToken || !salesmanToken || !projectId) return;

    const openRes = await request(app)
      .get(`/api/conversations/by-project/${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(openRes.status).toBe(200);
    const conversationId = openRes.body.data.id as string;

    const salesmanList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${salesmanToken}`);
    expect(salesmanList.status).toBe(200);
    const row = (salesmanList.body.data as Array<{ id: string }>).find(
      (c) => c.id === conversationId,
    );
    expect(row).toBeDefined();
  });

  it('merges legacy internal thread and backfills salesman on send', async () => {
    if (!adminToken || !salesmanToken || !projectId) return;

    const prisma = getPrisma();
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@digitalkingsmen.com' },
      select: { id: true },
    });
    if (!adminUser) return;

    const legacy = await prisma.conversation.create({
      data: {
        projectId,
        type: ConversationType.internal_project,
        members: { create: [{ userId: adminUser.id }] },
      },
    });

    const sendRes = await request(app)
      .post(`/api/conversations/${legacy.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ message: `Legacy merge ${Date.now()}`, internal_only: true });
    expect(sendRes.status).toBe(201);

    const byProject = await request(app)
      .get(`/api/conversations/by-project/${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byProject.status).toBe(200);
    const unifiedId = byProject.body.data.id as string;

    const salesmanList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${salesmanToken}`);
    const row = (salesmanList.body.data as Array<{ id: string }>).find(
      (c) => c.id === unifiedId,
    );
    expect(row).toBeDefined();
    expect(unifiedId).not.toBe(legacy.id);
  });

  it('client cannot read internal-only messages in unified thread', async () => {
    if (!adminToken || !clientToken || !projectId) return;

    const openRes = await request(app)
      .get(`/api/conversations/by-project/${projectId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const conversationId = openRes.body.data.id as string;

    await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ message: `Team note ${Date.now()}`, internal_only: true });

    const clientMsgs = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientMsgs.status).toBe(200);
    const bodies = (clientMsgs.body.data as Array<{ message?: string; internalOnly?: boolean }>).map(
      (m) => m.message,
    );
    expect(bodies.some((b) => b?.includes('Team note'))).toBe(false);
  });

  it('auto-provisions a unified conversation when a project is created', async () => {
    if (!adminToken || !salesmanToken) return;

    const projectsRes = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`);
    const existing = (projectsRes.body.data as Array<{ companyId?: string }>)[0];
    const companyId = existing?.companyId;
    if (!companyId) return;

    const createRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        company_id: companyId,
        name: `Messaging v1 ${Date.now()}`,
      });
    expect(createRes.status).toBe(201);
    const newProjectId = createRes.body.data.id as string;

    const byProject = await request(app)
      .get(`/api/conversations/by-project/${newProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byProject.status).toBe(200);
    expect(byProject.body.data.type).toBe('client_project');

    const salesmanList = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${salesmanToken}`);
    const row = (salesmanList.body.data as Array<{ id: string }>).find(
      (c) => c.id === byProject.body.data.id,
    );
    expect(row).toBeDefined();
  });
});
