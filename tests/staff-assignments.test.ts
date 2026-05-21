import { describe, it, expect } from 'vitest';
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

describe('Staff assignments API', () => {
  it('admin can list staff assignments for a user', async () => {
    const adminToken = await login('admin@digitalkingsmen.com');
    if (!adminToken) return;

    const staffRes = await request(app)
      .get('/api/users/staff')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(staffRes.status).toBe(200);
    const employee = staffRes.body.data?.find(
      (u: { role: string }) => u.role === 'employee',
    );
    if (!employee) return;

    const res = await request(app)
      .get(`/api/users/${employee.id}/staff-assignments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      const row = res.body.data[0];
      expect(row).toHaveProperty('companyId');
      expect(row.company).toMatchObject({ id: expect.any(String), name: expect.any(String) });
      expect(row.staffTag).toMatchObject({ id: expect.any(String), label: expect.any(String) });
    }
  });

  it('non-admin cannot list user staff assignments', async () => {
    const employeeToken = await login('employee@digitalkingsmen.com');
    const adminToken = await login('admin@digitalkingsmen.com');
    if (!employeeToken || !adminToken) return;

    const staffRes = await request(app)
      .get('/api/users/staff')
      .set('Authorization', `Bearer ${adminToken}`);
    const employee = staffRes.body.data?.find(
      (u: { role: string }) => u.role === 'employee',
    );
    if (!employee) return;

    const res = await request(app)
      .get(`/api/users/${employee.id}/staff-assignments`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
  });

  it('admin can add and remove a client assignment for a user', async () => {
    const adminToken = await login('admin@digitalkingsmen.com');
    if (!adminToken) return;

    const [companiesRes, tagsRes, staffRes] = await Promise.all([
      request(app)
        .get('/api/companies?limit=50')
        .set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/staff-tags').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/users/staff').set('Authorization', `Bearer ${adminToken}`),
    ]);

    const company = companiesRes.body.data?.[0];
    const webDevTag = tagsRes.body.data?.find((t: { slug: string }) => t.slug === 'web_dev');
    const employee = staffRes.body.data?.find((u: { role: string }) => u.role === 'employee');
    if (!company || !webDevTag || !employee) return;

    const createRes = await request(app)
      .post(`/api/companies/${company.id}/staff-assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: employee.id, staff_tag_id: webDevTag.id });

    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body.success).toBe(true);
    const assignmentId = createRes.body.data.id;

    const listRes = await request(app)
      .get(`/api/users/${employee.id}/staff-assignments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(
      listRes.body.data.some(
        (a: { id: string; companyId: string }) =>
          a.id === assignmentId && a.companyId === company.id,
      ),
    ).toBe(true);

    const deleteRes = await request(app)
      .delete(`/api/companies/${company.id}/staff-assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.deleted).toBe(true);
  });
});
