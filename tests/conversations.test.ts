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
