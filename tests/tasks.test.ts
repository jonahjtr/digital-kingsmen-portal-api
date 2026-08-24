import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();

const ADMIN = { email: 'admin@digitalkingsmen.com', password: 'Demo123!' };
const CLIENT = { email: 'client-pure@example.com', password: 'Demo123!' };
const EMPLOYEE = { email: 'employee@digitalkingsmen.com', password: 'Demo123!' };

async function login(email: string, password: string): Promise<string | null> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200 || !res.body.success) return null;
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Tasks API', () => {
  let adminToken: string | null = null;
  let clientToken: string | null = null;
  let employeeToken: string | null = null;
  let projectId: string | null = null;
  let companyId: string | null = null;
  let employeeId: string | null = null;
  let dbReady = false;

  beforeAll(async () => {
    try {
      const count = await prisma.user.count();
      dbReady = count > 0;
      if (!dbReady) {
        console.warn('Run npm run db:seed before task tests for full coverage');
        return;
      }
      const project = await prisma.project.findFirst({
        select: { id: true, companyId: true },
      });
      projectId = project?.id ?? null;
      companyId = project?.companyId ?? null;
      const employee = await prisma.user.findFirst({
        where: { email: EMPLOYEE.email },
        select: { id: true },
      });
      employeeId = employee?.id ?? null;
      adminToken = await login(ADMIN.email, ADMIN.password);
      clientToken = await login(CLIENT.email, CLIENT.password);
      employeeToken = await login(EMPLOYEE.email, EMPLOYEE.password);
    } catch {
      console.warn('Database unavailable — task tests will be skipped');
      dbReady = false;
    }
  });

  it('POST /api/tasks creates a task', async () => {
    if (!dbReady || !adminToken || !projectId) return;

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({
        project_id: projectId,
        title: 'API test task',
        description: 'Created by vitest',
        status: 'backlog',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('API test task');
    expect(res.body.data.archivedAt).toBeFalsy();
  });

  it('PATCH archives and restores a task', async () => {
    if (!dbReady || !adminToken || !projectId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ project_id: projectId, title: 'Archive test task', status: 'todo' });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;

    const archiveRes = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set(auth(adminToken))
      .send({ archived: true });

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.archivedAt).toBeTruthy();

    const listRes = await request(app)
      .get('/api/tasks')
      .set(auth(adminToken))
      .query({ limit: 100 });

    expect(listRes.status).toBe(200);
    const listed = (listRes.body.data as { id: string }[]) ?? [];
    expect(listed.some((t) => t.id === taskId)).toBe(false);

    const includeArchivedRes = await request(app)
      .get('/api/tasks')
      .set(auth(adminToken))
      .query({ limit: 100, include_archived: 'true' });

    expect(includeArchivedRes.status).toBe(200);
    const withArchived = (includeArchivedRes.body.data as { id: string }[]) ?? [];
    expect(withArchived.some((t) => t.id === taskId)).toBe(true);

    const archivedOnlyRes = await request(app)
      .get('/api/tasks')
      .set(auth(adminToken))
      .query({ limit: 100, archived_only: 'true' });

    expect(archivedOnlyRes.status).toBe(200);
    const archivedOnly = (archivedOnlyRes.body.data as { id: string }[]) ?? [];
    expect(archivedOnly.some((t) => t.id === taskId)).toBe(true);
    for (const t of archivedOnly as { archivedAt?: string | null }[]) {
      expect(t.archivedAt).toBeTruthy();
    }

    const restoreRes = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set(auth(adminToken))
      .send({ archived: false });

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.data.archivedAt).toBeFalsy();

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('PATCH with nullable fields clears description and due date', async () => {
    if (!dbReady || !adminToken || !projectId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({
        project_id: projectId,
        title: 'Nullable fields test',
        description: 'Will be cleared',
        due_date: new Date().toISOString(),
      });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;

    const updateRes = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set(auth(adminToken))
      .send({ description: null, due_date: null });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.description).toBeNull();
    expect(updateRes.body.data.dueDate).toBeNull();

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('PATCH with empty body returns 400', async () => {
    if (!dbReady || !adminToken || !projectId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ project_id: projectId, title: 'Empty patch test' });

    const taskId = createRes.body.data.id as string;

    const res = await request(app).patch(`/api/tasks/${taskId}`).set(auth(adminToken)).send({});

    expect(res.status).toBe(400);

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('DELETE /api/tasks/:id removes a task', async () => {
    if (!dbReady || !adminToken || !projectId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ project_id: projectId, title: 'Delete test task' });

    const taskId = createRes.body.data.id as string;

    const deleteRes = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set(auth(adminToken));

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    const getRes = await request(app).get(`/api/tasks/${taskId}`).set(auth(adminToken));

    expect(getRes.status).toBe(404);
  });

  it('clients cannot archive or delete tasks', async () => {
    if (!dbReady || !adminToken || !clientToken || !projectId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({
        project_id: projectId,
        title: 'Client forbidden test',
        client_visible: true,
      });

    const taskId = createRes.body.data.id as string;

    const archiveRes = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set(auth(clientToken))
      .send({ archived: true });

    expect(archiveRes.status).toBe(403);

    const deleteRes = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set(auth(clientToken));

    expect(deleteRes.status).toBe(403);

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('POST /api/tasks creates an internal task without anchors', async () => {
    if (!dbReady || !adminToken) return;

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ title: `Internal task ${Date.now()}`, status: 'backlog' });

    expect(res.status).toBe(201);
    expect(res.body.data.companyId).toBeFalsy();
    expect(res.body.data.projectId).toBeFalsy();

    await request(app).delete(`/api/tasks/${res.body.data.id}`).set(auth(adminToken));
  });

  it('POST /api/tasks creates a company-only task', async () => {
    if (!dbReady || !adminToken || !companyId) return;

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({
        company_id: companyId,
        title: `Company-only task ${Date.now()}`,
        status: 'todo',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.companyId).toBe(companyId);
    expect(res.body.data.projectId).toBeFalsy();

    await request(app).delete(`/api/tasks/${res.body.data.id}`).set(auth(adminToken));
  });

  it('POST /api/tasks derives company_id from project', async () => {
    if (!dbReady || !adminToken || !projectId || !companyId) return;

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ project_id: projectId, title: `Project task ${Date.now()}` });

    expect(res.status).toBe(201);
    expect(res.body.data.projectId).toBe(projectId);
    expect(res.body.data.companyId).toBe(companyId);

    await request(app).delete(`/api/tasks/${res.body.data.id}`).set(auth(adminToken));
  });

  it('GET /api/tasks?company_id includes company-only tasks', async () => {
    if (!dbReady || !adminToken || !companyId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ company_id: companyId, title: `Filter company task ${Date.now()}` });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;

    const listRes = await request(app)
      .get('/api/tasks')
      .set(auth(adminToken))
      .query({ company_id: companyId, limit: 200 });

    expect(listRes.status).toBe(200);
    const ids = ((listRes.body.data as { id: string }[]) ?? []).map((t) => t.id);
    expect(ids).toContain(taskId);

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('GET /api/tasks?scope=mine returns only assigned tasks', async () => {
    if (!dbReady || !adminToken || !employeeToken || !employeeId) return;

    const assignedRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({
        title: `Assigned scope test ${Date.now()}`,
        assigned_to: employeeId,
      });

    const unassignedRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ title: `Unassigned scope test ${Date.now()}` });

    expect(assignedRes.status).toBe(201);
    expect(unassignedRes.status).toBe(201);

    const assignedId = assignedRes.body.data.id as string;
    const unassignedId = unassignedRes.body.data.id as string;

    const listRes = await request(app)
      .get('/api/tasks')
      .set(auth(employeeToken))
      .query({ scope: 'mine', limit: 200 });

    expect(listRes.status).toBe(200);
    const ids = ((listRes.body.data as { id: string }[]) ?? []).map((t) => t.id);
    expect(ids).toContain(assignedId);
    expect(ids).not.toContain(unassignedId);

    await request(app).delete(`/api/tasks/${assignedId}`).set(auth(adminToken));
    await request(app).delete(`/api/tasks/${unassignedId}`).set(auth(adminToken));
  });

  it('clients cannot create internal tasks', async () => {
    if (!dbReady || !clientToken) return;

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(clientToken))
      .send({ title: 'Client internal attempt' });

    expect(res.status).toBe(403);
  });

  it('clients cannot see internal tasks', async () => {
    if (!dbReady || !adminToken || !clientToken) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ title: `Hidden internal ${Date.now()}` });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;

    const getRes = await request(app).get(`/api/tasks/${taskId}`).set(auth(clientToken));
    expect(getRes.status).toBe(404);

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('employees can list internal tasks', async () => {
    if (!dbReady || !adminToken || !employeeToken) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ title: `Staff internal ${Date.now()}` });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;

    const listRes = await request(app)
      .get('/api/tasks')
      .set(auth(employeeToken))
      .query({ limit: 200, search: createRes.body.data.title });

    expect(listRes.status).toBe(200);
    const ids = ((listRes.body.data as { id: string }[]) ?? []).map((t) => t.id);
    expect(ids).toContain(taskId);

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('PATCH reassigns task to company-only', async () => {
    if (!dbReady || !adminToken || !companyId) return;

    const createRes = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ title: `Reassign test ${Date.now()}` });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;

    const patchRes = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set(auth(adminToken))
      .send({ company_id: companyId, project_id: null });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.companyId).toBe(companyId);
    expect(patchRes.body.data.projectId).toBeFalsy();

    await request(app).delete(`/api/tasks/${taskId}`).set(auth(adminToken));
  });

  it('rejects client_visible without a company', async () => {
    if (!dbReady || !adminToken) return;

    const res = await request(app)
      .post('/api/tasks')
      .set(auth(adminToken))
      .send({ title: 'Invalid client visible', client_visible: true });

    expect(res.status).toBe(400);
  });
});
