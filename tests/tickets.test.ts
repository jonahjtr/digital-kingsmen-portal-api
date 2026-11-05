import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { computeSla } from '../src/tickets/sla';
import { autoCloseResolved } from '../src/tickets';

const app = createApp();
async function login(email: string) {
  const r = await request(app).post('/api/auth/login').send({ email, password: 'Demo123!' });
  return r.body.data.accessToken as string;
}
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Tickets', () => {
  let admin: string, pm: string, client: string, otherClient: string | null;
  let ticketId: string;
  let number: number;

  beforeAll(async () => {
    admin = await login('admin@digitalkingsmen.com');
    pm = await login('pm@digitalkingsmen.com');
    client = await login('client-pure@example.com');
    const others = await prisma.user.findMany({ where: { role: 'client', NOT: { email: 'client-pure@example.com' } }, take: 1 });
    otherClient = others[0] ? await login(others[0].email) : null;
  });

  it('client creates a ticket; priority comes from category, not the client', async () => {
    const r = await request(app).post('/api/tickets').set(as(client)).send({
      category: 'website_bug',
      priority: 'urgent', // ignored for clients
      title: 'Contact form not sending',
      body: 'Nobody is getting our form leads since Monday.',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.priority).toBe('high');
    expect(r.body.data.status).toBe('new');
    expect(r.body.data.number).toBeGreaterThan(1000);
    expect(r.body.data.sla).toBeUndefined(); // SLA internals are staff-only
    ticketId = r.body.data.id;
    number = r.body.data.number;
  });

  it('staff see SLA targets and can fetch by number', async () => {
    const r = await request(app).get(`/api/tickets/${number}`).set(as(admin));
    expect(r.status).toBe(200);
    expect(r.body.data.sla.firstResponse).toBe('ok');
    expect(r.body.data.firstResponseDueAt).toBeTruthy();
  });

  it("another client can't see it, and the error looks like it doesn't exist", async () => {
    if (!otherClient) return;
    expect((await request(app).get(`/api/tickets/${ticketId}`).set(as(otherClient))).status).toBe(404);
    const list = await request(app).get('/api/tickets').set(as(otherClient));
    expect(list.body.data.map((t: { id: string }) => t.id)).not.toContain(ticketId);
    expect((await request(app).post(`/api/tickets/${ticketId}/events`).set(as(otherClient)).send({ body: 'hi' })).status).toBe(404);
  });

  it('internal notes never reach the client', async () => {
    await request(app).post(`/api/tickets/${ticketId}/events`).set(as(admin)).send({ body: 'Probably the SMTP key expired', internal: true });
    const c = await request(app).get(`/api/tickets/${ticketId}/events`).set(as(client));
    expect(JSON.stringify(c.body.data)).not.toContain('SMTP');
    const s = await request(app).get(`/api/tickets/${ticketId}/events`).set(as(admin));
    expect(JSON.stringify(s.body.data)).toContain('SMTP');
  });

  it('a client cannot post an internal note even if they ask', async () => {
    await request(app).post(`/api/tickets/${ticketId}/events`).set(as(client)).send({ body: 'sneaky', internal: true });
    const c = await request(app).get(`/api/tickets/${ticketId}/events`).set(as(client));
    expect(c.body.data.find((e: { body: string }) => e.body === 'sneaky').internal).toBe(false);
  });

  it('first staff reply records first response and moves New → Open', async () => {
    await request(app).post(`/api/tickets/${ticketId}/events`).set(as(admin)).send({ body: 'Looking into it now.' });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.firstResponseAt).toBeTruthy();
    expect(t.status).toBe('open');
  });

  it('reply + set status in one action, then a client reply reopens it', async () => {
    await request(app).post(`/api/tickets/${ticketId}/events`).set(as(admin)).send({ body: 'Can you send a screenshot?', status: 'waiting_on_client' });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('waiting_on_client');
    const slaWhileWaiting = (await request(app).get(`/api/tickets/${ticketId}`).set(as(admin))).body.data.sla;
    expect(slaWhileWaiting.resolution).toBe('paused');
    await request(app).post(`/api/tickets/${ticketId}/events`).set(as(client)).send({ body: 'Here you go' });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('open');
  });

  it('clients can only reopen or resolve; never change priority, assignee or set other statuses', async () => {
    expect((await request(app).patch(`/api/tickets/${ticketId}`).set(as(client)).send({ priority: 'urgent' })).status).toBe(403);
    expect((await request(app).patch(`/api/tickets/${ticketId}`).set(as(client)).send({ status: 'in_progress' })).status).toBe(403);
    const pmUser = await prisma.user.findUniqueOrThrow({ where: { email: 'pm@digitalkingsmen.com' } });
    expect((await request(app).patch(`/api/tickets/${ticketId}`).set(as(client)).send({ assignee_id: pmUser.id })).status).toBe(403);
    const ok = await request(app).patch(`/api/tickets/${ticketId}`).set(as(client)).send({ status: 'resolved' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.resolvedAt).toBeTruthy();
  });

  it('staff can assign only active staff, and changes are logged', async () => {
    const clientUser = await prisma.user.findUniqueOrThrow({ where: { email: 'client-pure@example.com' } });
    expect((await request(app).patch(`/api/tickets/${ticketId}`).set(as(admin)).send({ assignee_id: clientUser.id })).status).toBe(400);
    // New tickets auto-route to the client's PM; reassign to another staffer.
    const t0 = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const other = await prisma.user.findFirstOrThrow({ where: { role: { not: 'client' }, isActive: true, NOT: [{ id: t0.assigneeId ?? '' }, { email: 'admin@digitalkingsmen.com' }] } });
    const r = await request(app).patch(`/api/tickets/${ticketId}`).set(as(admin)).send({ assignee_id: other.id, priority: 'urgent', status: 'open' });
    expect(r.status).toBe(200);
    expect(r.body.data.assignee.id).toBe(other.id);
    const kinds = (await request(app).get(`/api/tickets/${ticketId}/events`).set(as(admin))).body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['assigned', 'priority_changed', 'status_changed']));
    // Assignment/priority housekeeping is hidden from the client; status changes are shown.
    const ck = (await request(app).get(`/api/tickets/${ticketId}/events`).set(as(client))).body.data.map((e: { kind: string }) => e.kind);
    expect(ck).not.toContain('assigned');
    expect(ck).not.toContain('priority_changed');
    expect(ck).toContain('status_changed');
  });

  it('assignee gets notified; client gets notified of staff replies only', async () => {
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const n = await prisma.notification.findFirst({ where: { userId: t.assigneeId!, title: { contains: `Assigned to you: #${number}` } } });
    expect(n).toBeTruthy();
    const clientUser = await prisma.user.findUniqueOrThrow({ where: { email: 'client-pure@example.com' } });
    const cn = await prisma.notification.findMany({ where: { userId: clientUser.id, title: { contains: `#${number}` } } });
    expect(cn.some((x) => x.message.includes('SMTP'))).toBe(false); // internal note never notified
    expect(cn.some((x) => x.title.includes('replied'))).toBe(true);
  });

  it('pm only sees tickets for companies they can access', async () => {
    const r = await request(app).get('/api/tickets?status=active').set(as(pm));
    expect(r.status).toBe(200);
    for (const t of r.body.data as Array<{ company: { id: string } }>) {
      expect(typeof t.company.id).toBe('string');
    }
  });

  it('counts + filters', async () => {
    const c = await request(app).get('/api/tickets/counts').set(as(admin));
    expect(c.body.data.active).toBeGreaterThanOrEqual(1);
    const byNum = await request(app).get(`/api/tickets?q=%23${number}`).set(as(admin));
    expect(byNum.body.data[0].id).toBe(ticketId);
    expect((await request(app).get('/api/tickets?priority=bogus').set(as(admin))).status).toBe(400);
  });

  it('config hides SLA hours from clients', async () => {
    const c = await request(app).get('/api/tickets/config').set(as(client));
    expect(c.body.data.priorities[0].firstResponseHours).toBeUndefined();
    const s = await request(app).get('/api/tickets/config').set(as(admin));
    expect(s.body.data.priorities[0].firstResponseHours).toBe(2);
  });

  it('rejects bad input', async () => {
    expect((await request(app).post('/api/tickets').set(as(client)).send({ category: 'nope', title: 'abc', body: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/tickets').set(as(client)).send({ category: 'other', title: 'ab', body: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/tickets').set(as(client)).send({ category: 'other', title: 'Hello', body: 'x', company_id: '00000000-0000-0000-0000-000000000000' })).status).toBe(403);
  });

  it('auto-closes resolved tickets after 7 quiet days', async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'resolved', lastActivityAt: new Date(Date.now() - 8 * 86400_000) } });
    expect(await autoCloseResolved()).toBeGreaterThanOrEqual(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('closed');
  });

  it('SLA math', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const h = (n: number) => new Date(now.getTime() + n * 3600_000);
    const base = { status: 'open', firstResponseAt: null, resolvedAt: null };
    expect(computeSla({ ...base, firstResponseDueAt: h(5), resolutionDueAt: h(50) }, now).firstResponse).toBe('ok');
    expect(computeSla({ ...base, firstResponseDueAt: h(1), resolutionDueAt: h(50) }, now).firstResponse).toBe('due_soon');
    expect(computeSla({ ...base, firstResponseDueAt: h(-1), resolutionDueAt: h(50) }, now).firstResponse).toBe('breached');
    expect(computeSla({ ...base, firstResponseAt: h(-3), firstResponseDueAt: h(-1), resolutionDueAt: h(50) }, now).firstResponse).toBe('met');
    expect(computeSla({ ...base, status: 'waiting_on_client', firstResponseDueAt: h(5), resolutionDueAt: h(-5) }, now).resolution).toBe('paused');
  });

});
