import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

/** 1:1 direct messages: only the two people can see/post; reopening reuses the thread. */
const app = createApp();
const login = async (email: string) =>
  (await request(app).post('/api/auth/login').send({ email, password: 'Demo123!' })).body.data.accessToken as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const uid = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

describe('Direct messages', () => {
  let admin: string, pm: string, client: string;
  let pmId: string, clientId: string, adminId: string;
  let dmId: string;

  beforeAll(async () => {
    admin = await login('admin@digitalkingsmen.com');
    pm = await login('pm@digitalkingsmen.com');
    client = await login('client-pure@example.com');
    [adminId, pmId, clientId] = await Promise.all(
      ['admin@digitalkingsmen.com', 'pm@digitalkingsmen.com', 'client-pure@example.com'].map(uid),
    );
  });

  it('staff opens a DM with one person, and reopening returns the same thread', async () => {
    const a = await request(app).post('/api/conversations').set(as(admin)).send({ type: 'direct', member_ids: [clientId] });
    expect(a.status).toBe(201);
    dmId = a.body.data.id;
    expect(a.body.data.members.map((m: { userId: string }) => m.userId).sort()).toEqual([adminId, clientId].sort());
    const b = await request(app).post('/api/conversations').set(as(admin)).send({ type: 'direct', member_ids: [clientId] });
    expect(b.body.data.id).toBe(dmId);
  });

  it('rejects zero or multiple recipients, and clients starting DMs', async () => {
    expect((await request(app).post('/api/conversations').set(as(admin)).send({ type: 'direct', member_ids: [] })).status).toBe(400);
    expect(
      (await request(app).post('/api/conversations').set(as(admin)).send({ type: 'direct', member_ids: [clientId, pmId] })).status,
    ).toBe(400);
    expect((await request(app).post('/api/conversations').set(as(client)).send({ type: 'direct', member_ids: [adminId] })).status).toBe(403);
  });

  it('recipient sees it titled with the sender name and can reply', async () => {
    await request(app).post(`/api/conversations/${dmId}/messages`).set(as(admin)).send({ message: 'hi just you' });
    const list = await request(app).get('/api/conversations').set(as(client));
    const row = (list.body.data as Array<{ id: string; title: string; isInternal: boolean; isDirect: boolean }>).find((c) => c.id === dmId)!;
    expect(row).toBeTruthy();
    expect(row.isDirect).toBe(true);
    expect(row.isInternal).toBe(false);
    expect(row.title).not.toBe('Direct message');
    const reply = await request(app).post(`/api/conversations/${dmId}/messages`).set(as(client)).send({ message: 'got it' });
    expect(reply.status).toBe(201);
  });

  it('lists people to message (staff only, never yourself)', async () => {
    const r = await request(app).get('/api/conversations/direct-candidates').set(as(admin));
    expect(r.status).toBe(200);
    const ids = (r.body.data as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toContain(clientId);
    expect(ids).toContain(pmId);
    expect(ids).not.toContain(adminId);
    expect((await request(app).get('/api/conversations/direct-candidates').set(as(client))).status).toBe(403);
  });

  it('client inbox preview never shows a team-only message', async () => {
    const list = await request(app).get('/api/conversations').set(as(client));
    const proj = (list.body.data as Array<{ id: string; type: string }>).find((c) => c.type === 'client_project')!;
    await request(app).get(`/api/conversations/${proj.id}/messages`).set(as(admin));
    await request(app).post(`/api/conversations/${proj.id}/messages`).set(as(admin)).send({ message: 'SECRET team note', internal_only: true });
    const after = await request(app).get('/api/conversations').set(as(client));
    const row = (after.body.data as Array<{ id: string; lastMessagePreview: string | null }>).find((c) => c.id === proj.id)!;
    expect(row.lastMessagePreview ?? '').not.toContain('SECRET');
  });

  it('voice memo: plays inline as audio and shows a voice preview in the inbox', async () => {
    const up = await request(app)
      .post('/api/files/upload')
      .set(as(admin))
      .field('category', 'other')
      .attach('file', Buffer.from('OggS fake audio'), { filename: 'voice-memo.ogg', contentType: 'audio/ogg' });
    expect(up.status).toBe(201);
    const sent = await request(app)
      .post(`/api/conversations/${dmId}/messages`)
      .set(as(admin))
      .send({ attachment_file_id: up.body.data.id });
    expect(sent.status).toBe(201);
    const file = await request(app).get(`/api/messages/${sent.body.data.id}/attachment`).set(as(client));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/^audio\/ogg/);
    expect(file.headers['content-disposition']).toMatch(/^inline/);
    const row = ((await request(app).get('/api/conversations').set(as(client))).body.data as Array<{ id: string; lastMessagePreview: string }>).find((c) => c.id === dmId)!;
    expect(row.lastMessagePreview).toBe('🎤 Voice memo');
  });

  it('edits keep the original, visible to the other member; deleting wipes history', async () => {
    const m = await request(app).post(`/api/conversations/${dmId}/messages`).set(as(admin)).send({ message: 'v1 original' });
    const id = m.body.data.id;
    await request(app).patch(`/api/messages/${id}`).set(as(admin)).send({ message: 'v2' });
    await request(app).patch(`/api/messages/${id}`).set(as(admin)).send({ message: 'v3 final' });
    expect((await request(app).patch(`/api/messages/${id}`).set(as(client)).send({ message: 'hack' })).status).toBe(403);
    const h = await request(app).get(`/api/messages/${id}/edits`).set(as(client));
    expect(h.status).toBe(200);
    expect(h.body.data.original).toBe('v1 original');
    expect(h.body.data.versions.map((v: { text: string }) => v.text)).toEqual(['v1 original', 'v2', 'v3 final']);
    expect((await request(app).get(`/api/messages/${id}/edits`).set(as(pm))).status).toBe(404);
    await request(app).delete(`/api/messages/${id}`).set(as(admin));
    expect((await request(app).get(`/api/messages/${id}/edits`).set(as(client))).status).toBe(404);
    expect(await prisma.messageEdit.count({ where: { messageId: id } })).toBe(0);
  });

  it('a third person cannot see or post in the DM', async () => {
    const list = await request(app).get('/api/conversations').set(as(pm));
    expect((list.body.data as Array<{ id: string }>).some((c) => c.id === dmId)).toBe(false);
    expect((await request(app).get(`/api/conversations/${dmId}/messages`).set(as(pm))).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${dmId}/messages`).set(as(pm)).send({ message: 'x' })).status).toBe(404);
    // and sending doesn't silently add members
    expect(await prisma.conversationMember.count({ where: { conversationId: dmId } })).toBe(2);
  });
});
