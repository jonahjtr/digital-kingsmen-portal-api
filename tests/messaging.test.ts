import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

/** Messaging platform features: history paging, edit/delete, reactions, typing, attachments. */
const app = createApp();

async function login(email: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ email, password: 'Demo123!' });
  return r.body.data.accessToken;
}
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Messaging platform', () => {
  let admin: string, pm: string, client: string;
  let convId: string;
  let clientId: string;

  beforeAll(async () => {
    admin = await login('admin@digitalkingsmen.com');
    pm = await login('pm@digitalkingsmen.com');
    client = await login('client-pure@example.com');
    clientId = (await prisma.user.findUniqueOrThrow({ where: { email: 'client-pure@example.com' } })).id;
    const list = await request(app).get('/api/conversations').set(as(client));
    convId = (list.body.data as Array<{ id: string; type: string }>).find((c) => c.type === 'client_project')!.id;
    // make sure staff are members too
    await request(app).get(`/api/conversations/${convId}/messages`).set(as(pm));
  });

  const send = (t: string, body: object) =>
    request(app).post(`/api/conversations/${convId}/messages`).set(as(t)).send(body);

  it('pages history newest-first with a before cursor', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await send(pm, { message: `page-test ${i}` });
      ids.push(r.body.data.id);
      await new Promise((res) => setTimeout(res, 5));
    }
    const latest = await request(app).get(`/api/conversations/${convId}/messages?cursor=latest&limit=3`).set(as(pm));
    expect(latest.body.meta.hasMore).toBe(true);
    const got = latest.body.data.map((m: { id: string }) => m.id);
    expect(got).toEqual(ids.slice(2)); // oldest→newest within the page
    const older = await request(app).get(`/api/conversations/${convId}/messages?before=${got[0]}&limit=2`).set(as(pm));
    expect(older.body.data.map((m: { id: string }) => m.id)).toEqual(ids.slice(0, 2));
  });

  it('clients never see team-only messages in paged history', async () => {
    await send(pm, { message: 'secret staff note', internal_only: true });
    const r = await request(app).get(`/api/conversations/${convId}/messages?cursor=latest&limit=100`).set(as(client));
    expect(JSON.stringify(r.body.data)).not.toContain('secret staff note');
  });

  it('only the author can edit; edit marks editedAt', async () => {
    const m = (await send(pm, { message: 'typo heer' })).body.data;
    expect((await request(app).patch(`/api/messages/${m.id}`).set(as(client)).send({ message: 'hacked' })).status).toBe(403);
    expect([403, 404]).toContain((await request(app).patch(`/api/messages/${m.id}`).set(as(admin)).send({ message: 'hacked' })).status); // even admins can't rewrite others' words
    const ok = await request(app).patch(`/api/messages/${m.id}`).set(as(pm)).send({ message: 'typo here' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.message).toBe('typo here');
    expect(ok.body.data.editedAt).toBeTruthy();
  });

  it('a client cannot touch a team-only message (looks like it does not exist)', async () => {
    const m = (await send(pm, { message: 'staff only', internal_only: true })).body.data;
    expect((await request(app).post(`/api/messages/${m.id}/reactions`).set(as(client)).send({ emoji: '👍' })).status).toBe(404);
    expect((await request(app).delete(`/api/messages/${m.id}`).set(as(client))).status).toBe(404);
  });

  it('delete is soft, wipes content, and only author/admin may delete', async () => {
    const m = (await send(client, { message: 'please remove' })).body.data;
    expect((await request(app).delete(`/api/messages/${m.id}`).set(as(pm))).status).toBe(403);
    const del = await request(app).delete(`/api/messages/${m.id}`).set(as(client));
    expect(del.status).toBe(200);
    expect(del.body.data.message).toBe('');
    expect(del.body.data.deletedAt).toBeTruthy();
    const row = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.message).toBe('');
    // deleted messages can't be edited or reacted to
    expect((await request(app).patch(`/api/messages/${m.id}`).set(as(client)).send({ message: 'x' })).status).toBe(404);
  });

  it('reactions toggle per user and reject non-emoji', async () => {
    const m = (await send(pm, { message: 'react to me' })).body.data;
    const r1 = await request(app).post(`/api/messages/${m.id}/reactions`).set(as(client)).send({ emoji: '👍' });
    expect(r1.body.data.reactions).toEqual([{ emoji: '👍', userIds: [clientId], names: [expect.any(String)] }]);
    await request(app).post(`/api/messages/${m.id}/reactions`).set(as(pm)).send({ emoji: '👍' });
    const r2 = await request(app).post(`/api/messages/${m.id}/reactions`).set(as(client)).send({ emoji: '👍' });
    expect(r2.body.data.reactions[0].userIds).toHaveLength(1); // client toggled off, pm remains
    for (const bad of ['a', '<script>', '👍hello', '']) {
      expect((await request(app).post(`/api/messages/${m.id}/reactions`).set(as(pm)).send({ emoji: bad })).status).toBe(400);
    }
    expect((await request(app).post(`/api/messages/${m.id}/reactions`).set(as(pm)).send({ emoji: '👍🏽' })).status).toBe(200);
  });

  it('typing relay requires membership', async () => {
    expect((await request(app).post(`/api/conversations/${convId}/typing`).set(as(client)).send({})).status).toBe(200);
    const other = await prisma.conversation.findFirst({ where: { members: { none: { userId: clientId } } } });
    if (other) {
      expect((await request(app).post(`/api/conversations/${other.id}/typing`).set(as(client)).send({})).status).toBe(404);
    }
  });

  it('attachments: only your own unattached upload; access follows the message', async () => {
    const up = await request(app)
      .post('/api/files/upload')
      .set(as(pm))
      .attach('file', Buffer.from('hello world'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(up.status).toBe(201);
    const fileId = up.body.data.id;
    // someone else can't attach my upload
    expect((await send(client, { message: '', attachment_file_id: fileId })).status).toBe(400);
    const staffNote = await send(pm, { message: '', attachment_file_id: fileId, internal_only: true });
    expect(staffNote.status).toBe(201);
    expect(staffNote.body.data.attachment.fileName).toBe('note.txt');
    // can't reuse the same file on a second message
    expect((await send(pm, { message: 'again', attachment_file_id: fileId })).status).toBe(400);
    // pm can download; client can't see a team-only attachment
    const dl = await request(app).get(`/api/messages/${staffNote.body.data.id}/attachment`).set(as(pm));
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/octet-stream'); // non-images never inline
    expect((await request(app).get(`/api/messages/${staffNote.body.data.id}/attachment`).set(as(client))).status).toBe(404);
    // and it does not show on the Files page
    const files = await request(app).get('/api/files').set(as(pm));
    expect(files.body.data.map((f: { id: string }) => f.id)).not.toContain(fileId);
  });

  it('rejects empty messages', async () => {
    expect((await send(pm, { message: '   ' })).status).toBe(400);
  });

  it('clients do not get staff emails from conversation detail', async () => {
    const r = await request(app).get(`/api/conversations/${convId}`).set(as(client));
    expect(JSON.stringify(r.body.data.members)).not.toContain('@digitalkingsmen.com');
  });
});
